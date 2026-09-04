import { readFile, writeFile } from "node:fs/promises";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { semanticReviewSchema, validateSemanticReview, type SemanticReviewInput } from "../../src/semantic-review.js";

export default function semanticReviewer(pi: ExtensionAPI) {
  const inputFile = process.env.SYSTEM_V0_REVIEW_INPUT;
  const outputFile = process.env.SYSTEM_V0_REVIEW_OUTPUT;
  if (!inputFile || !outputFile) throw new Error("Semantic review input/output paths are required");
  pi.registerTool(defineTool({
    name: "submit_semantic_review",
    label: "Submit semantic review",
    description: "Submit up to three concrete behavior-defect hypotheses grounded in the raw idea and supplied source. This tool validates citations and stores advisory evidence; it never edits the product or marks it passed.",
    parameters: semanticReviewSchema,
    async execute(_id, candidate) {
      const input = JSON.parse(await readFile(inputFile, "utf8")) as SemanticReviewInput;
      const validated = validateSemanticReview(candidate, input);
      if (!validated.review) {
        return { content: [{ type: "text", text: `Review rejected:\n${validated.errors.join("\n")}` }], details: { accepted: false } };
      }
      await writeFile(outputFile, `${JSON.stringify(validated.review, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return {
        content: [{ type: "text", text: "Review retained as source-grounded hypotheses, not executed proof." }],
        details: { accepted: true }, terminate: true,
      };
    },
  }));
}
