import { readFile } from "node:fs/promises";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendPatternRetrievalAudit } from "../../src/patterns/audit.js";
import { retrievePatterns } from "../../src/patterns/catalog.js";
import { submitProductSpecCandidate } from "../../src/product-spec/submit.js";
import type { SourceFragment } from "../../src/product-spec/types.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the ProductSpec interpreter`);
  return value;
}

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
      description: "Validate and save the final ProductSpec JSON. Validation errors are returned so the same session can repair and resubmit.",
      promptSnippet: "Submit the complete ProductSpec JSON for deterministic validation",
      promptGuidelines: [
        "Use submit_product_spec as the final action. If it returns validation errors, repair only those errors and submit again in the same session.",
      ],
      parameters: Type.Object({
        spec_json: Type.String({ minLength: 2, description: "The complete ProductSpec v0.1 encoded as JSON" }),
      }),
      async execute(_toolCallId, params) {
        const [idea, fragmentsJson] = await Promise.all([
          readFile(ideaFile, "utf8"),
          readFile(fragmentsFile, "utf8"),
        ]);
        const fragments = JSON.parse(fragmentsJson) as SourceFragment[];
        const submission = await submitProductSpecCandidate(params.spec_json, idea, fragments, outputFile);
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
