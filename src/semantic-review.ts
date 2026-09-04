import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { Type, type Static } from "typebox";
import type { BuildPlan } from "./build-plan/types.js";
import { createPiEnvironment } from "./pi-environment.js";
import { runPi, type CommandResult } from "./pi-runner.js";
import type { ProductSpec } from "./product-spec/types.js";
import { providerFromEnvironment, providerPiArguments } from "./provider.js";
import type { RepairDiagnosis } from "./repair.js";
import type { UsageSummary } from "./types.js";
import { collectUsageFromJsonLines } from "./usage.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_CONTEXT_CHARACTERS = 120_000;
export const MAX_REVIEW_RESPONSES = 2;

const boundedText = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "\\S" });
export const semanticReviewSchema = Type.Object({
  status: Type.Union([Type.Literal("findings"), Type.Literal("no_findings"), Type.Literal("inconclusive")]),
  findings: Type.Array(Type.Object({
    summary: boundedText(300),
    confidence: Type.Union([Type.Literal("high"), Type.Literal("medium")]),
    requirement_id: Type.Optional(boundedText(120)),
    requirement_quote: boundedText(800),
    user_sequence: Type.Array(boundedText(300), { minItems: 1, maxItems: 8 }),
    expected_behavior: boundedText(600),
    source_indicated_behavior: boundedText(800),
    evidence: Type.Array(Type.Object({
      path: boundedText(200),
      excerpt: boundedText(1800),
    }, { additionalProperties: false }), { minItems: 1, maxItems: 4 }),
    likely_affected_paths: Type.Array(boundedText(200), { minItems: 1, maxItems: 3 }),
  }, { additionalProperties: false }), { maxItems: 3 }),
  limitations: Type.Array(boundedText(500), { maxItems: 5 }),
}, { additionalProperties: false });

export type SemanticReview = Static<typeof semanticReviewSchema>;

export interface SemanticReviewInput {
  idea: string;
  requirements: Array<{ id: string; title: string; description: string; disposition: string }>;
  exclusions: string[];
  sources: Array<{ path: string; content: string }>;
  allowed_repair_paths: string[];
}

export interface SemanticReviewResult {
  status: "reviewed" | "unavailable";
  evidence_kind: "source-grounded model hypotheses; not executed proof";
  input_hash: string;
  review?: SemanticReview;
  errors: string[];
  command: CommandResult;
  usage: UsageSummary;
  events: string;
}

const validateSchema = new Ajv({ allErrors: true, strict: true }).compile<SemanticReview>(semanticReviewSchema);
const normalized = (value: string): string => value.replace(/\s+/gu, " ").trim();

/** Citation matching proves grounding only. It cannot establish that the model's interpretation is correct. */
export function validateSemanticReview(candidate: unknown, input: SemanticReviewInput): { review?: SemanticReview; errors: string[] } {
  if (!validateSchema(candidate)) {
    return { errors: (validateSchema.errors ?? []).map((error) => `${error.instancePath || "/"}: ${error.message}`) };
  }
  const errors: string[] = [];
  if ((candidate.status === "findings") !== (candidate.findings.length > 0)) {
    errors.push("status must be findings exactly when the findings array is nonempty");
  }
  const sources = new Map(input.sources.map((source) => [source.path, source.content]));
  for (const [index, finding] of candidate.findings.entries()) {
    if (!normalized(input.idea).includes(normalized(finding.requirement_quote))) {
      errors.push(`findings/${index}: requirement_quote must quote the raw user idea`);
    }
    if (finding.requirement_id && !input.requirements.some((requirement) => requirement.id === finding.requirement_id)) {
      errors.push(`findings/${index}: unknown requirement_id`);
    }
    for (const evidence of finding.evidence) {
      const source = sources.get(evidence.path);
      if (source === undefined || !normalized(source).includes(normalized(evidence.excerpt))) {
        errors.push(`findings/${index}: source excerpt does not match ${evidence.path}`);
      }
    }
    for (const file of finding.likely_affected_paths) {
      if (!input.allowed_repair_paths.includes(file)) errors.push(`findings/${index}: ${file} is not an allowed repair path`);
    }
  }
  return errors.length > 0 ? { errors } : { review: candidate, errors: [] };
}

export async function buildSemanticReviewInput(idea: string, spec: ProductSpec, plan: BuildPlan, appDirectory: string): Promise<SemanticReviewInput> {
  const paths = plan.file_ownership.filter((entry) =>
    (entry.owner === "AGENT" || entry.owner === "BLOCK") && /^src\/(?:product|system)\/.*\.tsx?$/u.test(entry.path)
      && !entry.path.includes("app-smoke.test") && !entry.path.includes("test-contract"),
  ).map((entry) => entry.path).sort();
  const sources = await Promise.all(paths.map(async (file) => {
    const absolute = path.resolve(appDirectory, file);
    if (!absolute.startsWith(`${path.resolve(appDirectory)}${path.sep}`)) throw new Error(`Unsafe review path: ${file}`);
    return { path: file, content: await readFile(absolute, "utf8") };
  }));
  const input: SemanticReviewInput = {
    idea,
    requirements: spec.requirements.map(({ id, title, description, disposition }) => ({ id, title, description, disposition })),
    exclusions: spec.exclusions,
    sources,
    allowed_repair_paths: plan.file_ownership.filter((entry) => entry.owner === "AGENT").map((entry) => entry.path),
  };
  if (JSON.stringify(input).length > MAX_CONTEXT_CHARACTERS) throw new Error("Semantic review context exceeds the bounded input size; no model call was made");
  return input;
}

export function buildSemanticReviewPiArguments(input: SemanticReviewInput, prompt: string, artifactDirectory: string): string[] {
  const provider = providerFromEnvironment();
  return [
    "--mode", "json", "--print", "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates",
    "--no-themes", "--no-context-files", "--no-builtin-tools", "--tools", "submit_semantic_review",
    "--system-prompt", prompt.trim(), "--session-dir", path.join(artifactDirectory, "sessions"),
    "--extension", path.join(REPOSITORY_ROOT, "solution", "extensions", "semantic-reviewer.ts"),
    ...providerPiArguments(provider.provider, provider.model),
    "--thinking", process.env.CHALLENGE_REVIEW_THINKING ?? "off",
    `Review this source snapshot against the raw idea. Submit only supported behavior defects, or no_findings/inconclusive.\n${JSON.stringify(input)}`,
  ];
}

export async function runSemanticReview(
  input: SemanticReviewInput,
  artifactDirectory: string,
  timeoutMs: number,
  maxModelCalls = MAX_REVIEW_RESPONSES,
): Promise<SemanticReviewResult> {
  if (!Number.isSafeInteger(maxModelCalls) || maxModelCalls < 1 || maxModelCalls > MAX_REVIEW_RESPONSES) {
    throw new Error(`Semantic review permits 1–${MAX_REVIEW_RESPONSES} provider responses`);
  }
  const serializedInput = JSON.stringify(input);
  if (serializedInput.length > MAX_CONTEXT_CHARACTERS) throw new Error("Semantic review context exceeds the bounded input size; no model call was made");
  await mkdir(artifactDirectory, { recursive: true });
  const inputFile = path.join(artifactDirectory, "review-input.json");
  const reviewFile = path.join(artifactDirectory, "semantic-review.json");
  const events = path.join(artifactDirectory, "events.jsonl");
  await writeFile(inputFile, `${serializedInput}\n`, { encoding: "utf8", flag: "wx" });
  const prompt = await readFile(path.join(REPOSITORY_ROOT, "solution", "semantic-review-prompt.md"), "utf8");
  const environment = await createPiEnvironment(artifactDirectory, {
    SYSTEM_V0_REVIEW_INPUT: inputFile,
    SYSTEM_V0_REVIEW_OUTPUT: reviewFile,
  });
  const command = await runPi(
    buildSemanticReviewPiArguments(input, prompt, artifactDirectory), REPOSITORY_ROOT, events,
    path.join(artifactDirectory, "pi.stderr.log"), timeoutMs, environment, maxModelCalls,
  );
  let validated: ReturnType<typeof validateSemanticReview>;
  try {
    validated = validateSemanticReview(JSON.parse(await readFile(reviewFile, "utf8")), input);
  } catch (error) {
    validated = { errors: [`No readable semantic review was submitted: ${String(error)}`] };
  }
  const usage = collectUsageFromJsonLines(await readFile(events, "utf8"));
  if (command.exitCode !== 0) validated.errors.push(`Reviewer exited with code ${command.exitCode}`);
  if (usage.model_calls === 0 || usage.model_calls > maxModelCalls) validated.errors.push("Reviewer usage did not satisfy the audited response limit");
  const result: SemanticReviewResult = {
    status: validated.review && validated.errors.length === 0 ? "reviewed" : "unavailable",
    evidence_kind: "source-grounded model hypotheses; not executed proof",
    input_hash: createHash("sha256").update(serializedInput).digest("hex"),
    ...(validated.review ? { review: validated.review } : {}),
    errors: validated.errors, command, usage, events,
  };
  await writeFile(path.join(artifactDirectory, "review-result.json"), `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return result;
}

/** High confidence permits investigation and a minimal repair, never an automatic passing check. */
export function semanticReviewRepairDiagnosis(result: SemanticReviewResult, input: SemanticReviewInput): RepairDiagnosis | undefined {
  if (result.status !== "reviewed" || !result.review) return undefined;
  if (result.input_hash !== createHash("sha256").update(JSON.stringify(input)).digest("hex") ||
      validateSemanticReview(result.review, input).errors.length > 0) return undefined;
  const finding = result.review.findings.find((candidate) => candidate.confidence === "high");
  if (!finding) return undefined;
  const permittedPaths = [...new Set([...finding.likely_affected_paths, "src/product/product.test.tsx"])]
    .filter((file) => input.allowed_repair_paths.includes(file)).sort();
  const evidence = [
    "## Repair stage\n\nsemantic hypothesis",
    `## Permitted repair paths\n\n${permittedPaths.map((file) => `- ${file}`).join("\n")}`,
    "## Source-grounded review hypothesis — not an executed failure",
    JSON.stringify(finding, null, 2),
    "First inspect whether the cited behavior follows from the current source. If it does, add a regression assertion for the user sequence and make the smallest responsible fix. If the hypothesis is contradicted, preserve the application and stop. Do not add scope, weaken existing tests, or treat the model opinion as proof. The harness will rerun the actual checks.",
  ].join("\n\n");
  return {
    stage: "unknown", permittedPaths, evidence,
    sourceFingerprint: result.input_hash,
    key: createHash("sha256").update(`${result.input_hash}\n${JSON.stringify(finding)}`).digest("hex"),
  };
}
