import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AppVerification,
  PartialRunResult,
  PortReclamationAudit,
  RunResult,
  TestRun,
  UsageSummary,
} from "./types.js";
import type { ProductSpec } from "./product-spec/types.js";

const FALLBACK_PARTIAL: PartialRunResult = {
  status: "failed",
  app_url: "http://localhost:3000",
  start_command: "npm run dev",
  summary: "The harness did not produce a valid report.partial.json file.",
  implemented_features: [],
  assumptions: [],
  tests_run: [],
};

const APP_DIRECTORY_START_COMMAND = "npm run dev";

function quotePosixShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function rootStartCommand(repositoryRoot: string, appDirectory: string): string {
  const relativeAppDirectory = path.relative(repositoryRoot, appDirectory).split(path.sep).join("/");
  return `npm --prefix ${quotePosixShellArgument(relativeAppDirectory)} run dev`;
}

function filteredStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeTestRun(value: unknown): TestRun | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.command !== "string" ||
    typeof candidate.journey !== "string" ||
    !["passed", "failed"].includes(String(candidate.result))
  ) return undefined;
  return {
    command: candidate.command,
    journey: candidate.journey,
    result: candidate.result as TestRun["result"],
  };
}

export function normalizePartialResult(value: unknown): PartialRunResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const result = value as Record<string, unknown>;
  const status = ["success", "partial", "failed"].includes(String(result.status))
    ? result.status as PartialRunResult["status"]
    : "partial";
  const testsRun = Array.isArray(result.tests_run)
    ? result.tests_run.map(normalizeTestRun).filter((test): test is TestRun => test !== undefined)
    : [];

  return {
    status,
    app_url: "http://localhost:3000",
    start_command: "npm run dev",
    summary: typeof result.summary === "string" ? result.summary : "Pi completed without a valid summary.",
    implemented_features: filteredStrings(result.implemented_features),
    assumptions: filteredStrings(result.assumptions),
    tests_run: testsRun,
  };
}

export async function readPartialResult(appDirectory: string): Promise<PartialRunResult> {
  try {
    const raw = await readFile(path.join(appDirectory, "report.partial.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return normalizePartialResult(parsed) ?? FALLBACK_PARTIAL;
  } catch {
    return FALLBACK_PARTIAL;
  }
}

export function productReport(spec: ProductSpec, verification: AppVerification): PartialRunResult {
  const evidence = new Map((verification.journeys ?? []).map((journey) => [journey.id, journey]));
  const testsRun: TestRun[] = spec.acceptance_journeys.map((journey) => {
    const executed = evidence.get(journey.id);
    const passed = executed?.result === "passed" && executed.testNames.length > 0;
    return {
      command: verification.checks.find((check) => /vitest|npm test/u.test(check.command))?.command ?? "vitest run",
      journey: passed ? journey.title : `${journey.title} — ${executed?.diagnostic ?? "No per-journey test evidence was recorded."}`,
      result: passed ? "passed" : "failed",
    };
  });
  const passed = verification.passed && testsRun.length > 0 && testsRun.every((journey) => journey.result === "passed");
  return {
    status: passed ? "success" : "partial",
    app_url: "http://localhost:3000",
    start_command: "npm run dev",
    summary: passed
      ? `Generated ${spec.product.summary} All declared journeys have passing generated tests; build and startup checks passed.`
      : `Generated ${spec.product.summary}, but one or more harness verification checks failed.`,
    implemented_features: spec.requirements
      .filter((requirement) => requirement.disposition === "IMPLEMENT" && requirement.journey_ids.length > 0
        && requirement.journey_ids.every((id) => evidence.get(id)?.result === "passed"
          && (evidence.get(id)?.testNames.length ?? 0) > 0))
      .map((requirement) => requirement.title),
    assumptions: [...spec.assumptions],
    tests_run: testsRun,
  };
}

export function composeResult(
  partial: PartialRunResult,
  usage: UsageSummary,
  piExitCode: number,
  verification: AppVerification,
  portReclamation: PortReclamationAudit,
  startCommand: string,
): RunResult {
  const runFailed = piExitCode !== 0 || usage.model_calls === 0 || partial.status === "failed";
  const productJourneysPassed =
    partial.tests_run.length > 0 && partial.tests_run.every((test) => test.result === "passed");
  const status = runFailed ? "failed" : verification.passed && productJourneysPassed ? partial.status : "partial";
  return {
    ...partial,
    status,
    app_url: "http://localhost:3000",
    start_command: startCommand,
    tests_run: partial.tests_run,
    harness_checks: verification.checks,
    ...usage,
    pi_exit_code: piExitCode,
    telemetry_source: "pi-json-event-stream",
    port_reclamation: portReclamation,
  };
}

export async function writeResult(
  appDirectory: string,
  result: RunResult,
  mirrorPaths: string[] = [],
): Promise<string[]> {
  const resultPath = path.join(appDirectory, "result.json");
  const writtenPaths: string[] = [];
  const destinations = [
    { path: resultPath, value: { ...result, start_command: APP_DIRECTORY_START_COMMAND } },
    ...mirrorPaths.map((destination) => ({ path: destination, value: result })),
  ];
  for (const destination of destinations) {
    try {
      await writeFile(destination.path, `${JSON.stringify(destination.value, null, 2)}\n`, "utf8");
      writtenPaths.push(destination.path);
    } catch (error) {
      console.warn(`Unable to write result destination ${destination.path}: ${String(error)}`);
    }
  }
  if (writtenPaths.length === 0) throw new Error("Unable to write result.json to any configured destination");
  return writtenPaths;
}

export function missingRequiredResultPaths(writtenPaths: string[], requiredPaths: string[]): string[] {
  const written = new Set(writtenPaths.map((destination) => path.resolve(destination)));
  return requiredPaths.filter((destination) => !written.has(path.resolve(destination)));
}
