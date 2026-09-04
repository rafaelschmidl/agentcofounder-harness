import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildPlan } from "./build-plan/types.js";
import { validateProductSpec } from "./product-spec/validate.js";
import { buildSemanticReviewInput, runSemanticReview, semanticReviewRepairDiagnosis } from "./semantic-review.js";

export function parseSemanticReviewArguments(argv: string[]) {
  let ideaFile = "";
  let appDirectory = "";
  let outputDirectory = "";
  let run = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--run") { run = true; continue; }
    if (!["--idea-file", "--app-dir", "--output-dir"].includes(argument ?? "")) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (argument === "--idea-file") ideaFile = path.resolve(value);
    else if (argument === "--app-dir") appDirectory = path.resolve(value);
    else outputDirectory = path.resolve(value);
  }
  if (!ideaFile || !appDirectory || !outputDirectory) {
    throw new Error("Usage: npm run semantic-review -- --idea-file <file> --app-dir <app> --output-dir <new evidence directory> [--run]\nWithout --run, prepares input only and makes no provider call.");
  }
  return { ideaFile, appDirectory, outputDirectory, run };
}

export function reviewableBuildPlan(candidate: unknown): BuildPlan {
  const entries = typeof candidate === "object" && candidate !== null
    ? (candidate as Record<string, unknown>).file_ownership : undefined;
  if (!Array.isArray(entries) || entries.length === 0 || entries.some((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return true;
    const file = entry as Record<string, unknown>;
    return typeof file.path !== "string" || file.path.length === 0 || path.isAbsolute(file.path)
      || file.path.split(/[\\/]/u).some((part) => part === "." || part === "..")
      || !["AGENT", "BLOCK", "LINKER"].includes(String(file.owner));
  })) throw new Error("Review requires a BuildPlan with safe file ownership paths");
  // A read-only review must support retained apps built with earlier block versions.
  return candidate as BuildPlan;
}

async function main(): Promise<void> {
  const args = parseSemanticReviewArguments(process.argv.slice(2));
  const idea = await readFile(args.ideaFile, "utf8");
  const specValidation = validateProductSpec(JSON.parse(await readFile(path.join(args.appDirectory, "idea_spec.json"), "utf8")), idea);
  if (!specValidation.spec) throw new Error(`Invalid ProductSpec: ${specValidation.errors.join("; ")}`);
  const plan = reviewableBuildPlan(JSON.parse(await readFile(path.join(args.appDirectory, "build_plan.json"), "utf8")));
  const input = await buildSemanticReviewInput(idea, specValidation.spec, plan, args.appDirectory);
  if (!args.run) {
    await mkdir(args.outputDirectory, { recursive: true });
    await writeFile(path.join(args.outputDirectory, "review-input.json"), `${JSON.stringify(input, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(`Prepared review input only at ${args.outputDirectory}; no provider call was made. Use --run with a new evidence directory to invoke the reviewer.`);
    return;
  }
  const result = await runSemanticReview(input, args.outputDirectory, 180_000);
  const diagnosis = semanticReviewRepairDiagnosis(result, input);
  if (diagnosis) {
    await writeFile(path.join(args.outputDirectory, "repair-diagnosis.json"), `${JSON.stringify(diagnosis, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  console.log(`Review ${result.status}; ${result.usage.model_calls} model calls retained at ${args.outputDirectory}. Findings are hypotheses. This probe did not edit the application.`);
  if (result.status !== "reviewed") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => { console.error(String(error)); process.exitCode = 1; });
}
