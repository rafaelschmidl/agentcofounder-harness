import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendPatternRetrievalAudit } from "../../src/patterns/audit.js";
import { retrievePatterns } from "../../src/patterns/catalog.js";
import { submitProductSpecDraftCandidate } from "../../src/product-spec/submit.js";
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
    (field) => field !== "source_idea_hash" && field !== "source_fragments",
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
  delete schema.$schema;
  delete schema.$id;
  schema.title = "Compact ProductSpec semantic draft";
  return schema;
}

const draftSchema = productSpecDraftSchema();

export default function productSpecInterpreter(pi: ExtensionAPI) {
  const ideaFile = requiredEnvironment("SYSTEM_V0_IDEA_FILE");
  const fragmentsFile = requiredEnvironment("SYSTEM_V0_FRAGMENTS_FILE");
  const outputFile = requiredEnvironment("SYSTEM_V0_PRODUCT_SPEC_FILE");
  const patternAuditFile = requiredEnvironment("SYSTEM_V0_PATTERN_AUDIT_FILE");

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
      description: "Expand, validate, and save a compact ProductSpec draft. The runner injects hashes, immutable fragments, and exact source ranges. Validation errors are returned for bounded repair.",
      promptSnippet: "Submit a compact semantic ProductSpec draft for deterministic expansion and validation",
      promptGuidelines: [
        "Use submit_product_spec as the final action. If it returns validation errors, repair only those errors and submit again in the same session.",
      ],
      parameters: Type.Object({
        draft: Type.Unsafe<unknown>(draftSchema),
      }),
      async execute(_toolCallId, params) {
        const [idea, fragmentsJson] = await Promise.all([
          readFile(ideaFile, "utf8"),
          readFile(fragmentsFile, "utf8"),
        ]);
        const fragments = JSON.parse(fragmentsJson) as SourceFragment[];
        const submission = await submitProductSpecDraftCandidate(JSON.stringify(params.draft), idea, fragments, outputFile);
        if (!submission.accepted) {
          return {
            content: [
              {
                type: "text",
                text: `ProductSpec rejected:\n${submission.errors.map((error) => `- ${error}`).join("\n")}`,
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
