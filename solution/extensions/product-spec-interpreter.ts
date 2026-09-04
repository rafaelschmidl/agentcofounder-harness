import { appendFileSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { COLLECTION_EXECUTION_SCHEMA } from "../../src/executable-collection/schema.js";
import { executableCollectionEnabled } from "../../src/executable-collection/types.js";
import { appendPatternRetrievalAudit } from "../../src/patterns/audit.js";
import { retrievePatterns } from "../../src/patterns/catalog.js";
import { replaceDraftValues, submitProductSpecDraftCandidate } from "../../src/product-spec/submit.js";
import { normalizeDraftContainer } from "../../src/product-spec/normalize-draft.js";
import type { SourceFragment } from "../../src/product-spec/types.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the ProductSpec interpreter`);
  return value;
}

export function productSpecDraftSchema(): Record<string, unknown> {
  const schema = JSON.parse(
    readFileSync(new URL("../../src/product-spec/product-spec.schema.json", import.meta.url), "utf8"),
  ) as {
    required: string[];
    properties: Record<string, unknown>;
    $defs: Record<string, unknown>;
    [key: string]: unknown;
  };
  schema.required = schema.required.filter(
    (field) => !["source_idea_hash", "source_fragments", "version"].includes(field),
  );
  delete schema.properties.source_idea_hash;
  delete schema.properties.source_fragments;
  schema.$defs.sourceReference = {
    type: "string",
    pattern: "^fragment-[a-f0-9]{12}-[1-9][0-9]*$",
    description: "Runner-provided source fragment ID; exact quote and offsets are injected deterministically",
  };
  const disposition = schema.$defs.fragmentDisposition as { required?: string[] } | undefined;
  if (disposition?.required) {
    disposition.required = disposition.required.filter((field) => field !== "requirement_ids");
  }
  const requirement = schema.$defs.requirement as { required?: string[] } | undefined;
  if (requirement?.required) {
    requirement.required = requirement.required.filter((field) => !["disposition", "journey_ids"].includes(field));
  }
  delete schema.$schema;
  delete schema.$id;
  schema.title = "Compact ProductSpec semantic draft";
  if (executableCollectionEnabled()) {
    schema.properties.collection_execution = COLLECTION_EXECUTION_SCHEMA;
    schema.required.push("collection_execution");
  }
  return schema;
}

const draftSchema = productSpecDraftSchema();

export default function productSpecInterpreter(pi: ExtensionAPI) {
  const ideaFile = requiredEnvironment("SYSTEM_V0_IDEA_FILE");
  const fragmentsFile = requiredEnvironment("SYSTEM_V0_FRAGMENTS_FILE");
  const outputFile = requiredEnvironment("SYSTEM_V0_PRODUCT_SPEC_FILE");
  const patternAuditFile = requiredEnvironment("SYSTEM_V0_PATTERN_AUDIT_FILE");
  let retainedDraft: unknown;

  pi.registerTool(
    defineTool({
      name: "retrieve_patterns",
      label: "Retrieve offline product patterns",
      description: "Search the bundled offline pattern catalogue for product and domain patterns relevant to the idea.",
      promptSnippet: "Search bundled product patterns by capability or domain signal",
      promptGuidelines: [
        "Use retrieve_patterns before drafting the ProductSpec, and only select returned versioned pattern IDs.",
      ],
      parameters: Type.Object({
        query: Type.String({ minLength: 1, description: "A compact capability and domain query derived from the idea" }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8, description: "Maximum cards to return" })),
      }),
      async execute(_toolCallId, params) {
        const result = retrievePatterns(params.query, params.limit ?? 4);
        await appendPatternRetrievalAudit(patternAuditFile, result);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "submit_product_spec",
      label: "Submit ProductSpec",
      description: "Expand, validate, and save a ProductSpec draft. Submit draft initially. After rejection, the draft is retained: use replacements with JSON Pointer paths to fix only invalid values instead of resending it. Every repair passes the same full validation.",
      promptSnippet: "Submit a compact semantic ProductSpec draft for deterministic expansion and validation",
      promptGuidelines: [
        "Submit draft initially. If rejected, use replacements to fix erroneous values in the retained draft. Supply either draft or replacements, never both.",
      ],
      executionMode: "sequential",
      prepareArguments(args) {
        // Retain before SDK validation. Exact container moves are audited; meaning is untouched.
        if (typeof args === "object" && args !== null && !Array.isArray(args)
          && Object.hasOwn(args, "draft") && !Object.hasOwn(args, "replacements")) {
          const rawDraft = (args as { draft: unknown }).draft;
          const normalized = normalizeDraftContainer(rawDraft, draftSchema);
          retainedDraft = structuredClone(normalized.draft);
          if (normalized.moves.length) {
            const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
            appendFileSync(join(dirname(outputFile), "draft-normalization.jsonl"), `${JSON.stringify({
              kind: "root-container-moves", moves: normalized.moves,
              raw_sha256: hash(rawDraft), normalized_sha256: hash(normalized.draft),
              raw_draft: rawDraft, normalized_draft: normalized.draft,
            })}\n`, "utf8");
            return { ...args, draft: normalized.draft };
          }
        }
        return args as { draft?: unknown; replacements?: { path: string; value: unknown }[] };
      },
      parameters: Type.Object({
        draft: Type.Optional(Type.Unsafe<unknown>(draftSchema)),
        replacements: Type.Optional(Type.Array(Type.Object({
          path: Type.String({ pattern: "^/", description: "JSON Pointer to an existing value, e.g. /requirements/0/source_refs" }),
          value: Type.Unknown({ description: "Replacement value; the full repaired draft is validated again" }),
        }), { minItems: 1, maxItems: 32 })),
      }),
      async execute(_toolCallId, params) {
        try {
          if (Object.hasOwn(params, "draft") === Object.hasOwn(params, "replacements")) {
            throw new Error("Supply exactly one of draft or replacements.");
          }
          retainedDraft = params.replacements
            ? replaceDraftValues(retainedDraft, params.replacements)
            : structuredClone(params.draft);
        } catch (error) {
          return {
            content: [{ type: "text", text: `Draft repair rejected: ${String(error)}` }],
            details: { accepted: false },
          };
        }
        const [idea, fragmentsJson] = await Promise.all([
          readFile(ideaFile, "utf8"),
          readFile(fragmentsFile, "utf8"),
        ]);
        const fragments = JSON.parse(fragmentsJson) as SourceFragment[];
        const submission = await submitProductSpecDraftCandidate(JSON.stringify(retainedDraft), idea, fragments, outputFile);
        if (!submission.accepted) {
          return {
            content: [
              {
                type: "text",
                text: `ProductSpec rejected:\n${submission.errors.map((error) => `- ${error}`).join("\n")}\n\nDraft retained. Fix these values with replacements using JSON Pointer paths (for example /requirements/0/source_refs). Do not repeat the full draft for a small correction.`,
              },
            ],
            details: submission,
          };
        }
        return {
          content: [{ type: "text", text: "ProductSpec accepted and saved." }],
          details: submission,
          terminate: true,
        };
      },
    }),
  );
}
