import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileProductSpec } from "../src/build-plan/compile.js";
import { materializeBuildPlan } from "../src/build-plan/materialize.js";
import { parseSemanticReviewArguments, reviewableBuildPlan } from "../src/run-semantic-review.js";
import { buildSemanticReviewInput, buildSemanticReviewPiArguments, semanticReviewRepairDiagnosis, validateSemanticReview, type SemanticReview, type SemanticReviewInput, type SemanticReviewResult } from "../src/semantic-review.js";
import { validProductSpec } from "./fixtures/product-spec.js";

const input: SemanticReviewInput = {
  idea: "I need to see and update the catalogue of products.",
  requirements: [{ id: "req_edit", title: "Edit products", description: "Update the selected product", disposition: "IMPLEMENT" }],
  exclusions: [],
  sources: [{ path: "src/product/App.tsx", content: "const [draft, setDraft] = useState(initial);\nonSave({ id: initial.id, ...draft });" }],
  allowed_repair_paths: ["src/product/App.tsx", "src/product/product.test.tsx"],
};
const review: SemanticReview = {
  status: "findings", limitations: ["Source review only; the sequence has not been executed."],
  findings: [{
    summary: "Switching edited record retains another product's draft", confidence: "high", requirement_id: "req_edit",
    requirement_quote: "see and update the catalogue of products",
    user_sequence: ["Edit product A", "Switch to product B without closing the form", "Save"],
    expected_behavior: "B retains its own fields until edited.",
    source_indicated_behavior: "The mounted form keeps A's draft while saving under B's identity.",
    evidence: [{ path: "src/product/App.tsx", excerpt: "const [draft, setDraft] = useState(initial);" }],
    likely_affected_paths: ["src/product/App.tsx"],
  }],
};
function result(candidate = review): SemanticReviewResult {
  return {
    status: "reviewed", evidence_kind: "source-grounded model hypotheses; not executed proof",
    input_hash: createHash("sha256").update(JSON.stringify(input)).digest("hex"), review: candidate, errors: [], events: "/review/events.jsonl",
    command: { exitCode: 0, timedOut: false, modelCalls: 1, callLimitReached: false, successfulToolCalls: 1, toolLimitReached: false, completedFiles: [], requiredFilesComplete: false },
    usage: { model_calls: 1, input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 2, reasoning_tokens: 0, cost_total: 0, call_log: [] },
  };
}

describe("semantic review evidence", () => {
  it("requires matching idea and code citations before offering a bounded repair diagnosis", () => {
    expect(validateSemanticReview(review, input).errors).toEqual([]);
    const diagnosis = semanticReviewRepairDiagnosis(result(), input)!;
    expect(diagnosis.permittedPaths).toEqual(["src/product/App.tsx", "src/product/product.test.tsx"]);
    expect(diagnosis.evidence).toContain("not an executed failure");
    expect(diagnosis.evidence).toContain("regression assertion");
    expect(diagnosis.evidence).toContain("If the hypothesis is contradicted");
    for (const mutation of [
      { requirement_quote: "Add a customer portal" },
      { requirement_quote: " " },
      { requirement_id: "invented_requirement" },
      { evidence: [{ path: "src/product/App.tsx", excerpt: "fictionalFunction()" }] },
      { evidence: [{ path: "src/product/App.tsx", excerpt: " " }] },
      { likely_affected_paths: ["src/system/repository.ts"] },
    ]) {
      const candidate = structuredClone(review);
      Object.assign(candidate.findings[0]!, mutation);
      expect(validateSemanticReview(candidate, input).errors.length).toBeGreaterThan(0);
      expect(semanticReviewRepairDiagnosis(result(candidate), input)).toBeUndefined();
    }
  });

  it("does not turn no findings, uncertainty, unavailable output, or a stale snapshot into repair authority", () => {
    const empty: SemanticReview = { status: "no_findings", findings: [], limitations: [] };
    expect(validateSemanticReview(empty, input).review?.status).toBe("no_findings");
    expect(semanticReviewRepairDiagnosis(result(empty), input)).toBeUndefined();
    const medium = structuredClone(review);
    medium.findings[0]!.confidence = "medium";
    expect(semanticReviewRepairDiagnosis(result(medium), input)).toBeUndefined();
    expect(semanticReviewRepairDiagnosis({ ...result(), status: "unavailable" }, input)).toBeUndefined();
    expect(semanticReviewRepairDiagnosis(result(), { ...input, idea: `${input.idea} No billing.` })).toBeUndefined();
    expect(validateSemanticReview({ ...review, status: "no_findings" }, input).errors).not.toEqual([]);
  });

  it("starts a separate constrained review session without product write tools or builder history", () => {
    const args = buildSemanticReviewPiArguments(input, "Independent review", "/review");
    expect(args).toContain("--no-builtin-tools");
    expect(args[args.indexOf("--tools") + 1]).toBe("submit_semantic_review");
    expect(args[args.indexOf("--session-dir") + 1]).toBe("/review/sessions");
    expect(args).not.toContain("write,edit");
    expect(args).not.toContain("--continue");
    expect(args.at(-1)).toContain(input.idea);
  });

  it("prepares the standalone probe without provider calls unless --run is explicit", () => {
    const args = ["--idea-file", "idea.txt", "--app-dir", "app", "--output-dir", "review"];
    expect(parseSemanticReviewArguments(args).run).toBe(false);
    expect(parseSemanticReviewArguments([...args, "--run"]).run).toBe(true);
    expect(() => parseSemanticReviewArguments(["--app-dir", "--run"])).toThrow("Missing value");
    const retainedPlan = { blocks: [{ id: "ui.accessible-shell", version: "1.0.0" }], file_ownership: [{ path: "src/product/App.tsx", owner: "AGENT" }] };
    expect(reviewableBuildPlan(retainedPlan)).toBe(retainedPlan);
    expect(() => reviewableBuildPlan({ file_ownership: [{ path: "../secret.ts", owner: "AGENT" }] })).toThrow("safe file ownership paths");
  });

  it("builds a reproducible source snapshot without unrelated files or seed smoke tests", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "semantic-input-"));
    try {
      const spec = validProductSpec();
      const plan = compileProductSpec(spec);
      await materializeBuildPlan(plan, spec, directory);
      await writeFile(path.join(directory, ".env.local"), "not part of the source snapshot");
      const captured = await buildSemanticReviewInput(input.idea, spec, plan, directory);
      expect(captured.sources.some((source) => source.path === "src/product/product.test.tsx")).toBe(true);
      expect(captured.sources.some((source) => source.path === "src/system/repository.ts")).toBe(true);
      expect(captured.sources.some((source) => source.path.includes("app-smoke") || source.path.includes(".env"))).toBe(false);
      expect(captured.sources.map((source) => source.path)).toEqual([...captured.sources.map((source) => source.path)].sort());
      await writeFile(path.join(directory, "src/product/App.tsx"), "x".repeat(121_000));
      await expect(buildSemanticReviewInput(input.idea, spec, plan, directory)).rejects.toThrow("no model call was made");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
