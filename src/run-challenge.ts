import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareOutput } from "./prepare-output.js";
import {
  buildBuilderPiArguments,
  buildRepairPiArguments,
  loadBuilderPrompts,
  loadRepairPrompts,
} from "./builder.js";
import { compileProductSpec } from "./build-plan/compile.js";
import { executableCollectionEnabled } from "./executable-collection/types.js";
import {
  linkBuildPlan,
  materializeBuildPlan,
  writeCompilerArtifacts,
} from "./build-plan/materialize.js";
import { validateBuildPlan } from "./build-plan/validate.js";
import { createPiEnvironment } from "./pi-environment.js";
import { runPi } from "./pi-runner.js";
import { runProductSpecInterpretation } from "./product-spec/interpreter.js";
import { auditAppPortAfterPi } from "./port-owner.js";
import { collectRepairDiagnosis, hasCompletedRepairResponse, MAX_REPAIR_CYCLES, type RepairDiagnosis } from "./repair.js";
import {
  composeResult,
  missingRequiredResultPaths,
  productReport,
  rootStartCommand,
  writeResult,
} from "./result.js";
import { collectUsageFromJsonLines } from "./usage.js";
import { RunTrace } from "./trace.js";
import { MAX_PROVIDER_RESPONSES, runLimitsFromEnvironment } from "./run-limits.js";
import { buildSemanticReviewInput, MAX_REVIEW_RESPONSES, runSemanticReview, semanticReviewRepairDiagnosis } from "./semantic-review.js";
import type { AppVerification, RunResult } from "./types.js";
import type { BuildPlan } from "./build-plan/types.js";
import { validateResultObject } from "./validate-result.js";
import { captureRequiredArtifacts, portHasListener, unavailableAppVerification, verifyGeneratedApp } from "./verify-app.js";

interface Arguments {
  ideaFile: string;
  outputDirectory: string;
  prepareOnly: boolean;
  skipAppInstall: boolean;
  verificationPort: number;
  printRunLimits: boolean;
}

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SOURCE_DIRECTORY, "..");

export { runPi, type CommandResult } from "./pi-runner.js";

export function scopeRepairToOwnership(diagnosis: RepairDiagnosis, plan: BuildPlan): RepairDiagnosis {
  const permittedPaths = diagnosis.permittedPaths.filter((file) => plan.file_ownership.some((entry) => entry.path === file && entry.owner === "AGENT"));
  if (permittedPaths.length === diagnosis.permittedPaths.length) return diagnosis;
  const evidence = diagnosis.evidence.replace(/## Permitted repair paths\n\n[\s\S]*?(?=\n\n## |$)/u,
    `## Permitted repair paths\n\n${permittedPaths.map((file) => `- ${file}`).join("\n")}`)
    + "\n\nCompiler-owned domain semantics cannot be rewritten. Fix integration errors using the actual supplied domain API; never weaken journey assertions to hide a domain mismatch.";
  return { ...diagnosis, permittedPaths, evidence, key: createHash("sha256").update(`${diagnosis.key}\n${permittedPaths.join("\n")}`).digest("hex") };
}

export function runRequiresFailureExit(
  piExitCode: number,
  resultStatus: RunResult["status"],
  missingResultPaths: string[],
): boolean {
  return missingResultPaths.length > 0 || piExitCode !== 0 || resultStatus !== "success";
}

export async function diagnoseVerification(
  verificationDirectory: string,
  outputDirectory: string,
  verification: AppVerification,
): Promise<RepairDiagnosis> {
  const incompleteFiles = verification.incompleteFiles ?? [];
  // Command outcomes cover CSS/Vite failures and test collection errors that have no TS code or failed assertion.
  const failed = (pattern: RegExp): boolean => incompleteFiles.length === 0 &&
    verification.checks.some((check) => pattern.test(check.command) && check.result === "failed");
  const diagnosis = await collectRepairDiagnosis(verificationDirectory, outputDirectory, {
    build: failed(/\brun build$/u),
    tests: failed(/vitest|\bnpm test\b/u),
    startup: failed(/\brun dev(?:\s|$)/u),
  });
  const uncovered = (verification.journeys ?? []).filter((journey) => journey.result !== "passed");
  if (incompleteFiles.length === 0 && uncovered.length === 0) return diagnosis;
  const missingEvidence = incompleteFiles.length > 0
    ? `Required files are missing, empty, or still contain their seed: ${incompleteFiles.join(", ")}. Write their complete implementation.`
    : uncovered.map((journey) => `${journey.id}: ${journey.diagnostic}`).join("\n");
  const permittedPaths = incompleteFiles.length > 0 ? incompleteFiles
    : diagnosis.stage === "unknown" ? ["src/product/product.test.tsx"] : diagnosis.permittedPaths;
  const permittedEvidence = `## Permitted repair paths\n\n${permittedPaths.map((file) => `- ${file}`).join("\n")}`;
  const existingEvidence = incompleteFiles.length > 0 ? permittedEvidence
    : diagnosis.evidence.replace(/## Permitted repair paths\n\n[\s\S]*?(?=\n\n## |$)/u, permittedEvidence);
  const evidence = `${existingEvidence}\n\n## Required completion evidence\n\n${missingEvidence}\n\nFor missing journey tests, add meaningful assertions under the exact [journey_id] tag; do not merely rename unrelated tests.`;
  return {
    ...diagnosis,
    key: createHash("sha256").update(`${diagnosis.key}\n${missingEvidence}`).digest("hex"),
    evidence,
    permittedPaths,
  };
}

async function readRetainedPiEvents(artifactDirectory: string): Promise<string> {
  const eventFiles = [
    path.join(artifactDirectory, "interpreter", "interpreter.events.jsonl"),
    path.join(artifactDirectory, "builder", "events.jsonl"),
    path.join(artifactDirectory, "semantic-review", "events.jsonl"),
  ];
  const repairsDirectory = path.join(artifactDirectory, "repairs");
  try {
    const repairAttempts = (await readdir(repairsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^attempt-\d+$/u.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
    eventFiles.push(...repairAttempts.map((entry) => path.join(repairsDirectory, entry.name, "events.jsonl")));
  } catch {
    // A failed run may not have reached repair.
  }
  const retained = await Promise.all(eventFiles.map(async (file) => {
    try {
      return await readFile(file, "utf8");
    } catch {
      return "";
    }
  }));
  return retained.join("");
}

function printHelp(): void {
  console.log(`Usage: npm run challenge -- [options]

Options:
  --idea-file <path>      Idea prompt file (default: contract-public/development-idea.txt)
  --output-dir <path>     Generated app directory below output/ (default: output/app)
  --prepare-only          Reset the app from the seed without invoking Pi
  --skip-app-install      Do not run npm ci in the generated app
  --verification-port <n> Development verification port (default: 3000; delivered app contract is unchanged)
  --print-run-limits      Print validated response limits without preparing an app or invoking Pi
  --help                  Show this help

Environment:
  CHALLENGE_PROVIDER      Optional Pi provider override
  CHALLENGE_MODEL         Optional Pi model override
  CHALLENGE_THINKING      Optional Pi thinking level (default: off)
  CHALLENGE_BUILDER_THINKING Optional builder thinking level (default: off)
  CHALLENGE_MAX_OUTPUT_TOKENS Per-response output cap, including reasoning (default: 8192; maximum: 32768)
  CHALLENGE_TIMEOUT_MS    Wall-clock limit for the full run (default: 1800000)
  CHALLENGE_SEMANTIC_REVIEW Set to 1 for an experimental source review after functional checks (default: off)
  CHALLENGE_EXECUTABLE_COLLECTION Set to 1 for experimental compiler-owned collection semantics (default: off)
`);
}

export function parseArguments(argv: string[]): Arguments {
  const parsed: Arguments = {
    ideaFile: path.join(REPOSITORY_ROOT, "contract-public", "development-idea.txt"),
    outputDirectory: path.join("output", "app"),
    prepareOnly: false,
    skipAppInstall: false,
    verificationPort: 3000,
    printRunLimits: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      printHelp();
      process.exit(0);
    }
    if (argument === "--prepare-only") {
      parsed.prepareOnly = true;
      continue;
    }
    if (argument === "--print-run-limits") {
      parsed.printRunLimits = true;
      continue;
    }
    if (argument === "--skip-app-install") {
      parsed.skipAppInstall = true;
      continue;
    }
    if (argument === "--verification-port") {
      const value = argv[index + 1];
      if (!value || !/^\d+$/u.test(value) || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 65535) {
        throw new Error("--verification-port requires an integer from 1 to 65535");
      }
      parsed.verificationPort = Number(value);
      index += 1;
      continue;
    }
    if (argument === "--idea-file" || argument === "--output-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      if (argument === "--idea-file") parsed.ideaFile = path.resolve(value);
      else parsed.outputDirectory = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function commandName(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

async function runInherited(command: string, args: string[], cwd: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env, shell: false });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

export function buildPiArguments(
  idea: string,
  systemPrompt: string,
  publicJourneys: string,
  appContext: string,
  artifactDirectory: string,
): string[] {
  const args = [
    "--mode",
    "json",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--append-system-prompt",
    `${systemPrompt.trim()}\n\n${publicJourneys.trim()}\n\n${appContext.trim()}`,
    "--session-dir",
    path.join(artifactDirectory, "sessions"),
    "--extension",
    path.join(REPOSITORY_ROOT, "solution", "extensions", "protected-paths.ts"),
    "--skill",
    path.join(REPOSITORY_ROOT, "solution", "skills", "mvp-builder"),
  ];
  if (process.env.CHALLENGE_PROVIDER) args.push("--provider", process.env.CHALLENGE_PROVIDER);
  if (process.env.CHALLENGE_MODEL) args.push("--model", process.env.CHALLENGE_MODEL);
  args.push("--thinking", process.env.CHALLENGE_THINKING ?? "off");
  args.push(`## Product idea\n\n${idea.trim()}\n`);
  return args;
}

function timeoutFromEnvironment(): number {
  const raw = process.env.CHALLENGE_TIMEOUT_MS ?? "1800000";
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000) {
    throw new Error("CHALLENGE_TIMEOUT_MS must be an integer of at least 1000");
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const runLimits = runLimitsFromEnvironment();
  if (args.printRunLimits) {
    console.log(JSON.stringify(runLimits));
    return;
  }
  const runDeadline = Date.now() + timeoutFromEnvironment();
  const remainingTime = (): number => {
    const remaining = runDeadline - Date.now();
    if (remaining < 1_000) throw new Error("System v0 exceeded CHALLENGE_TIMEOUT_MS");
    return remaining;
  };
  const idea = await readFile(args.ideaFile, "utf8");
  const outputDirectory = await prepareOutput(REPOSITORY_ROOT, args.outputDirectory);
  console.log(`Prepared clean application workspace: ${outputDirectory}`);

  if (!args.skipAppInstall) {
    const installCode = await runInherited(
      commandName("npm"),
      ["ci", "--ignore-scripts", "--prefer-offline"],
      outputDirectory,
    );
    if (installCode !== 0) throw new Error(`App dependency installation failed with exit code ${installCode}`);
  }
  if (args.prepareOnly) return;

  let artifactDirectory: string | undefined;
  let traceFile: string | undefined;
  let trace: RunTrace | undefined;
  try {
  const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  artifactDirectory = path.join(REPOSITORY_ROOT, "artifacts", "runs", runId);
  const interpreterDirectory = path.join(artifactDirectory, "interpreter");
  const builderDirectory = path.join(artifactDirectory, "builder");
  await Promise.all([
    mkdir(interpreterDirectory, { recursive: true }),
    mkdir(builderDirectory, { recursive: true }),
  ]);
  await writeFile(path.join(REPOSITORY_ROOT, "artifacts", "run-limits.json"), `${JSON.stringify(runLimits, null, 2)}\n`, "utf8");
  await writeFile(path.join(artifactDirectory, "idea.txt"), idea, "utf8");
  traceFile = path.join(artifactDirectory, "trace.jsonl");
  trace = await RunTrace.create(traceFile);
  await trace.record("interpretation", "started", "Started ProductSpec interpretation from the raw idea.", { run_limits: runLimits });

  const appPortHadListenerBeforePi = await portHasListener(args.verificationPort);
  const interpretation = await runProductSpecInterpretation(idea, interpreterDirectory, remainingTime());
  if (interpretation.command.exitCode !== 0 || !interpretation.spec || interpretation.errors.length > 0) {
    await trace.record("interpretation", "failed", "ProductSpec interpretation did not produce a valid specification.", {
      exit_code: interpretation.command.exitCode,
      errors: interpretation.errors,
    });
    throw new Error(`ProductSpec interpretation failed: ${interpretation.errors.join("; ")}`);
  }
  const spec = interpretation.spec;
  await trace.record("interpretation", "completed", "Validated ProductSpec v0.1.", {
    requirements: spec.requirements.length,
    journeys: spec.acceptance_journeys.length,
    selected_patterns: spec.selected_patterns,
  });

  await trace.record("compilation", "started", "Started deterministic ProductSpec compilation.");
  const plan = compileProductSpec(spec, { executableCollection: executableCollectionEnabled() });
  const planValidation = validateBuildPlan(plan, spec);
  if (!planValidation.valid) {
    await trace.record("compilation", "failed", "BuildPlan validation failed.", { errors: planValidation.errors });
    throw new Error(`BuildPlan validation failed: ${planValidation.errors.join("; ")}`);
  }
  await Promise.all([
    writeFile(path.join(artifactDirectory, "idea_spec.json"), `${JSON.stringify(spec, null, 2)}\n`, "utf8"),
    writeFile(path.join(artifactDirectory, "build_plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8"),
  ]);
  await materializeBuildPlan(plan, spec, outputDirectory);
  await writeCompilerArtifacts(plan, spec, outputDirectory);
  const requiredProductPaths = plan.file_ownership.filter((entry) => entry.owner === "AGENT").map((entry) => entry.path);
  const requiredArtifacts = await captureRequiredArtifacts(outputDirectory, requiredProductPaths);
  await trace.record("compilation", "completed", "BuildPlan validated and deterministic blocks materialized.", {
    blocks: plan.blocks.map((block) => `${block.id}@${block.version}`),
    custom_slots: plan.custom_slots.map((slot) => slot.id),
  });

  await trace.record("customization", "started", "Started constrained product customization.");
  const prompts = await loadBuilderPrompts(outputDirectory, plan);
  const builderEvents = path.join(builderDirectory, "events.jsonl");
  const builderStderr = path.join(builderDirectory, "pi.stderr.log");
  const builderEnvironment = await createPiEnvironment(builderDirectory, {
    SYSTEM_V0_OWNERSHIP_FILE: path.join(outputDirectory, "file_ownership.json"),
  });
  const builder = await runPi(
    buildBuilderPiArguments(spec, plan, prompts.systemPrompt, prompts.appContext, builderDirectory),
    outputDirectory,
    builderEvents,
    builderStderr,
    remainingTime(),
    builderEnvironment,
    Math.max(1, MAX_PROVIDER_RESPONSES - interpretation.command.modelCalls),
    Number.POSITIVE_INFINITY,
    requiredProductPaths,
  );
  if (builder.exitCode !== 0) {
    await trace.record("customization", "failed", "The constrained builder did not complete.", {
      exit_code: builder.exitCode,
      timed_out: builder.timedOut,
      successful_owned_writes: builder.successfulToolCalls,
      completed_files: builder.completedFiles,
    });
  } else {
    await trace.record("customization", "completed", "The constrained builder completed within AGENT-owned files.", {
      successful_owned_writes: builder.successfulToolCalls,
      stopped_after_required_files: builder.requiredFilesComplete,
      completed_files: builder.completedFiles,
    });
  }
  const stageEventFiles = [interpretation.files.events, builderEvents];
  let customizationExitCode = builder.exitCode;
  let runTimedOut = interpretation.command.timedOut || builder.timedOut;
  await linkBuildPlan(plan, spec, outputDirectory);
  await trace.record("linking", "completed", "Deterministic routes, exports, and entry points were linked.");

  let verification = unavailableAppVerification("Pi did not complete before the run deadline");
  // An interrupted response can leave repairable files. Verification, not process exit alone, diagnoses them.
  if (!builder.timedOut) {
    const diagnosisKeys = new Set<string>();
    let semanticReviewed = false;
    for (let attempt = 0; attempt <= MAX_REPAIR_CYCLES; attempt += 1) {
      const verificationDirectory = path.join(artifactDirectory, "verification", `attempt-${attempt}`);
      await mkdir(verificationDirectory, { recursive: true });
      await trace.record("verification", "started", `Started generated application verification attempt ${attempt}.`);
      verification = await verifyGeneratedApp(outputDirectory, verificationDirectory, {
        port: args.verificationPort,
        displayRoot: REPOSITORY_ROOT,
        requiredArtifacts,
        journeys: spec.acceptance_journeys,
      });
      await trace.record(
        "verification",
        verification.passed ? "completed" : "failed",
        verification.passed
          ? `Verification attempt ${attempt} passed.`
          : `Verification attempt ${attempt} produced targeted failure evidence.`,
        { attempt, checks: verification.checks },
      );
      let semanticDiagnosis: RepairDiagnosis | undefined;
      if (verification.passed && !semanticReviewed && attempt < MAX_REPAIR_CYCLES && process.env.CHALLENGE_SEMANTIC_REVIEW === "1") {
        semanticReviewed = true;
        const reviewedEvents = path.join(artifactDirectory, "semantic-review", "events.jsonl");
        try {
          const prior = (await Promise.all(stageEventFiles.map((file) => readFile(file, "utf8")))).join("");
          // Keep at least two responses available to investigate a finding and repair it.
          const reviewCalls = Math.min(MAX_REVIEW_RESPONSES, MAX_PROVIDER_RESPONSES - collectUsageFromJsonLines(prior).model_calls - 2);
          const reviewTime = Math.min(180_000, runDeadline - Date.now());
          if (reviewCalls > 0 && reviewTime >= 1_000) {
            const input = await buildSemanticReviewInput(idea, spec, plan, outputDirectory);
            const review = await runSemanticReview(input, path.dirname(reviewedEvents), reviewTime, reviewCalls);
            semanticDiagnosis = semanticReviewRepairDiagnosis(review, input);
            await trace.record("semantic-review", review.status === "reviewed" ? "completed" : "failed",
              "Experimental source review retained hypotheses; it did not certify or invalidate functional verification.", {
                status: review.status, findings: review.review?.findings.length ?? 0,
                model_calls: review.usage.model_calls, repair_hypothesis: Boolean(semanticDiagnosis), errors: review.errors,
              });
          } else {
            await trace.record("semantic-review", "decision", "Skipped optional review because insufficient run budget remained.");
          }
        } catch (error) {
          await trace.record("semantic-review", "failed", "Optional source review was unavailable; prior functional evidence remains unchanged.", { error: String(error) });
        } finally {
          // Retain provider usage even if optional review setup or result processing failed.
          if (await readFile(reviewedEvents, "utf8").then(() => true, () => false)) stageEventFiles.push(reviewedEvents);
        }
      }
      if ((verification.passed && !semanticDiagnosis) || attempt === MAX_REPAIR_CYCLES) break;

      const diagnosis = scopeRepairToOwnership(semanticDiagnosis ?? await diagnoseVerification(verificationDirectory, outputDirectory, verification), plan);
      if (diagnosis.permittedPaths.length === 0) {
        await trace.record("repair", "failed", "Failure is confined to compiler-owned semantics; product code cannot rewrite that contract.", { diagnosis_key: diagnosis.key });
        break;
      }
      if (diagnosisKeys.has(diagnosis.key)) {
        await trace.record("repair", "failed", "Refused a repair with an unchanged diagnosis.", {
          attempt: attempt + 1,
          diagnosis_key: diagnosis.key,
        });
        break;
      }
      const priorEvents = (await Promise.all(stageEventFiles.map((file) => readFile(file, "utf8")))).join("");
      const remainingCalls = MAX_PROVIDER_RESPONSES - collectUsageFromJsonLines(priorEvents).model_calls;
      if (remainingCalls < 1) {
        await trace.record("repair", "failed", "No provider responses remained for diagnosed repair.", {
          attempt: attempt + 1,
          diagnosis_key: diagnosis.key,
        });
        break;
      }

      const repairAttempt = attempt + 1;
      const repairDirectory = path.join(artifactDirectory, "repairs", `attempt-${repairAttempt}`);
      await mkdir(repairDirectory, { recursive: true });
      const repairPrompts = await loadRepairPrompts(
        outputDirectory,
        plan,
        diagnosis.evidence,
        diagnosis.permittedPaths,
      );
      const repairEvents = path.join(repairDirectory, "events.jsonl");
      const repairStderr = path.join(repairDirectory, "pi.stderr.log");
      const repairEnvironment = await createPiEnvironment(repairDirectory, {
        SYSTEM_V0_OWNERSHIP_FILE: path.join(outputDirectory, "file_ownership.json"),
        SYSTEM_V0_PERMITTED_PATHS: JSON.stringify(diagnosis.permittedPaths),
      });
      await trace.record("repair", "started", `Started diagnosed repair attempt ${repairAttempt}.`, {
        attempt: repairAttempt,
        diagnosis_key: diagnosis.key,
        remaining_model_calls: remainingCalls,
      });
      // A repair may change previously passing behavior before failing or timing out.
      verification = unavailableAppVerification(`Repair attempt ${repairAttempt} has not been verified`);
      const repair = await runPi(
        buildRepairPiArguments(
          spec,
          plan,
          repairPrompts.systemPrompt,
          repairPrompts.appContext,
          repairDirectory,
          repairAttempt,
          diagnosis.permittedPaths,
        ),
        outputDirectory,
        repairEvents,
        repairStderr,
        remainingTime(),
        repairEnvironment,
        remainingCalls,
        Number.POSITIVE_INFINITY,
        [],
        ["finish_repair"],
      );
      stageEventFiles.push(repairEvents);
      const repairReachedModel = hasCompletedRepairResponse(await readFile(repairEvents, "utf8"));
      if (repairReachedModel) diagnosisKeys.add(diagnosis.key);
      customizationExitCode = repair.exitCode;
      runTimedOut ||= repair.timedOut;
      await trace.record(
        "repair",
        repair.exitCode === 0 ? "completed" : "failed",
        repair.exitCode === 0
          ? `Diagnosed repair attempt ${repairAttempt} completed.`
          : `Diagnosed repair attempt ${repairAttempt} did not complete.`,
        {
          attempt: repairAttempt,
          diagnosis_key: diagnosis.key,
          exit_code: repair.exitCode,
          completed_model_response: repairReachedModel,
          successful_tool_calls: repair.successfulToolCalls,
          completion_tool: repair.completionTool,
        },
      );
      await linkBuildPlan(plan, spec, outputDirectory);
      await trace.record("linking", "completed", `Relinked after repair attempt ${repairAttempt}.`);
      if (repair.timedOut) break;
    }
  }

  const portReclamation = await auditAppPortAfterPi(args.verificationPort, outputDirectory, appPortHadListenerBeforePi);
  if (portReclamation.listener_after_pi) {
    const message = `${portReclamation.diagnostic}; pids=${portReclamation.process_ids.join(",") || "none"}`;
    if (portReclamation.reclaimed) console.log(message);
    else console.warn(message);
  }

  const eventFile = path.join(artifactDirectory, "events.jsonl");
  const eventContent = (await Promise.all(stageEventFiles.map((file) => readFile(file, "utf8")))).join("");
  await writeFile(eventFile, eventContent, { encoding: "utf8", flag: "wx" });
  const usage = collectUsageFromJsonLines(eventContent);
  const responseLimitPassed = usage.model_calls <= MAX_PROVIDER_RESPONSES &&
    usage.call_log.every((call) => call.output_tokens <= runLimits.max_output_tokens_per_response);
  const piExitCode = interpretation.command.exitCode !== 0
    ? interpretation.command.exitCode
    : customizationExitCode !== 0 || !responseLimitPassed
      ? (customizationExitCode || 1)
      : 0;
  const startCommand = rootStartCommand(REPOSITORY_ROOT, outputDirectory);
  const partial = productReport(spec, verification);
  await Promise.all([
    writeFile(path.join(outputDirectory, "report.partial.json"), `${JSON.stringify(partial, null, 2)}\n`, "utf8"),
    writeFile(path.join(artifactDirectory, "report.partial.json"), `${JSON.stringify(partial, null, 2)}\n`, "utf8"),
  ]);
  let result = composeResult(partial, usage, piExitCode, verification, portReclamation, startCommand);
  const appResultPath = path.join(outputDirectory, "result.json");
  const rootResultPath = path.join(REPOSITORY_ROOT, "result.json");
  const requiredResultPaths = [appResultPath, rootResultPath];
  const resultPaths = await writeResult(outputDirectory, result, [rootResultPath]);
  const missingResultPaths = missingRequiredResultPaths(resultPaths, requiredResultPaths);
  const validationErrors = await validateResultObject(result);
  if (validationErrors.length > 0) {
    for (const error of validationErrors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  await trace.record("delivery", "completed", "Validated result and retained System v0 artifacts.", {
    status: result.status,
    model_calls: result.model_calls,
    cost_total: result.cost_total,
    run_limits: runLimits,
  });
  await copyFile(traceFile, path.join(outputDirectory, "trace.jsonl"));

  console.log(`Result written to ${resultPaths.join(" and ")}`);
  console.log(`Audit artifacts written to ${artifactDirectory}`);
  for (const missingResultPath of missingResultPaths) {
    console.error(`Required result destination was not written: ${missingResultPath}`);
  }
  if (runTimedOut) {
    console.error("System v0 exceeded CHALLENGE_TIMEOUT_MS and was terminated.");
  }
  if (runRequiresFailureExit(piExitCode, result.status, missingResultPaths)) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const eventContent = artifactDirectory ? await readRetainedPiEvents(artifactDirectory) : "";
    const usage = collectUsageFromJsonLines(eventContent);
    const verification = unavailableAppVerification(message);
    const portReclamation = {
      preexisting_listener: false,
      listener_after_pi: false,
      attempted: false,
      reclaimed: false,
      process_ids: [],
      diagnostic: "Run failed before the final port reclamation audit completed.",
    };
    const partial = {
      status: "failed" as const,
      app_url: "http://localhost:3000",
      start_command: "npm run dev",
      summary: `System v0 failed: ${message}`,
      implemented_features: [],
      assumptions: [],
      tests_run: [],
    };
    const result = composeResult(
      partial,
      usage,
      1,
      verification,
      portReclamation,
      rootStartCommand(REPOSITORY_ROOT, outputDirectory),
    );
    await writeFile(path.join(outputDirectory, "report.partial.json"), `${JSON.stringify(partial, null, 2)}\n`, "utf8");
    await writeResult(outputDirectory, result, [path.join(REPOSITORY_ROOT, "result.json")]);
    if (artifactDirectory) {
      await writeFile(path.join(artifactDirectory, "report.partial.json"), `${JSON.stringify(partial, null, 2)}\n`, "utf8");
    }
    if (trace && traceFile) {
      await trace.record("delivery", "failed", "Retained truthful failure artifacts.", {
        error: message,
        model_calls: usage.model_calls,
        cost_total: usage.cost_total,
      });
      await copyFile(traceFile, path.join(outputDirectory, "trace.jsonl"));
    }
    console.error(message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
