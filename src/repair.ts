import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const MAX_REPAIR_CYCLES = 7;
const MAX_LOG_CHARACTERS = 12_000;
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/gu;

/** Setup failures and transport errors did not let the model address a diagnosis. */
export function hasCompletedRepairResponse(events: string): boolean {
  return events.split(/\r?\n/u).some((line) => {
    try {
      const event = JSON.parse(line);
      return event.type === "message_end" && event.message?.role === "assistant"
        && ["stop", "toolUse", "length"].includes(event.message.stopReason);
    } catch {
      return false;
    }
  });
}

export interface RepairDiagnosis {
  key: string;
  sourceFingerprint: string;
  evidence: string;
  stage: "build" | "tests" | "startup" | "unknown";
  permittedPaths: string[];
}

export interface FailedVerificationStages {
  build?: boolean;
  tests?: boolean;
  startup?: boolean;
}

async function fingerprintSources(outputDirectory: string, permittedPaths: readonly string[]): Promise<string> {
  const sources = await Promise.all(permittedPaths.map(async (relativePath) => {
    try {
      return `${relativePath}\0${await readFile(path.join(outputDirectory, relativePath), "utf8")}`;
    } catch {
      return `${relativePath}\0(unavailable)`;
    }
  }));
  return createHash("sha256").update(sources.join("\0\0")).digest("hex");
}

const AGENT_PATH_PATTERN = /\b(src\/product\/(?:App\.tsx|domain\.ts|product\.test\.tsx|styles\.css))(?=[():\s]|$)/gu;

function agentPaths(content: string): string[] {
  return [...new Set([...content.matchAll(AGENT_PATH_PATTERN)].map((match) => match[1]!))].sort();
}

async function readLogTail(file: string): Promise<string> {
  try {
    const content = await readFile(file, "utf8");
    return content.slice(-MAX_LOG_CHARACTERS);
  } catch {
    return "(log unavailable)";
  }
}

async function readTestFailures(file: string): Promise<string> {
  try {
    const report = JSON.parse(await readFile(file, "utf8")) as {
      testResults?: Array<{
        assertionResults?: Array<{
          title?: unknown;
          fullName?: unknown;
          status?: unknown;
          failureMessages?: unknown;
        }>;
      }>;
    };
    const failures = (report.testResults ?? [])
      .flatMap((suite) => suite.assertionResults ?? [])
      .filter((assertion) => assertion.status === "failed")
      .map((assertion) => {
        const title = typeof assertion.fullName === "string" ? assertion.fullName
          : typeof assertion.title === "string" ? assertion.title : "unnamed test";
        const messages = Array.isArray(assertion.failureMessages)
          ? assertion.failureMessages.filter((message): message is string => typeof message === "string")
          : [];
        const message = messages.join("\n").replace(ANSI_ESCAPE, "");
        // Group identical diagnostics, not their expected/received values or
        // selectors. Repeated DOM dumps often hide the actual source locations.
        const diagnostic = message.split(/\n(?:Here are the matching elements:|Ignored nodes:|\s+at )/u)[0]!.trim();
        const locations = message.split(/\r?\n/u).filter((line) => /(?:\bat |❯).*src\/product\//u.test(line));
        return { title, diagnostic: diagnostic || message, excerpt: message.slice(0, 3_000), locations };
      });
    const groups = new Map<string, typeof failures>();
    for (const failure of failures) {
      const group = groups.get(failure.diagnostic) ?? [];
      group.push(failure);
      groups.set(failure.diagnostic, group);
    }
    return failures.length > 0 ? [...groups.values()].map((group) => {
      const locations = [...new Set(group.flatMap((failure) => failure.locations))];
      return `### Failed tests (${group.length})\n\n${group.map((failure) => `- ${failure.title}`).join("\n")}\n\n${group[0]!.excerpt}`
        + (locations.length > 0 ? `\n\nSource locations:\n${locations.join("\n")}` : "");
    }).join("\n\n") : "(no failed assertions in JSON report)";
  } catch {
    return "(test result JSON unavailable)";
  }
}

export async function collectRepairDiagnosis(
  verificationDirectory: string,
  outputDirectory: string,
  failedStages: FailedVerificationStages = {},
): Promise<RepairDiagnosis> {
  const logs = [
    ["product tests", "app-test.log"],
    ["production build", "app-build.log"],
    ["development startup", "app-dev.log"],
  ] as const;
  const rawLogs = await Promise.all(logs.map(
    async ([label, filename]) => ({ label, content: await readLogTail(path.join(verificationDirectory, filename)) }),
  ));
  const testFailures = await readTestFailures(path.join(verificationDirectory, "app-test-results.json"));
  const buildLog = rawLogs.find((entry) => entry.label === "production build")?.content ?? "";
  const testLog = rawLogs.find((entry) => entry.label === "product tests")?.content ?? "";
  const startupLog = rawLogs.find((entry) => entry.label === "development startup")?.content ?? "";
  const hasBuildErrors = failedStages.build === true || /error TS\d+/u.test(buildLog);
  const buildPaths = hasBuildErrors ? agentPaths(buildLog) : [];
  const assertionPaths = agentPaths(testFailures);
  const testingLibraryFailure = /TestingLibraryElementError|Unable to find|Found multiple elements/iu.test(testFailures);
  const defaultAppSmokeFailed = /compiled application smoke contract|default App without React runtime errors|app-smoke\.test\.tsx/iu
    .test(testFailures);
  const testPaths = assertionPaths.length > 0 ? assertionPaths : agentPaths(testLog);
  const startupPaths = agentPaths(startupLog);
  const stage = hasBuildErrors
    ? "build"
    : failedStages.tests === true || (testFailures !== "(no failed assertions in JSON report)" && testFailures !== "(test result JSON unavailable)")
      ? "tests"
      : failedStages.startup === true || startupPaths.length > 0
        ? "startup"
        : "unknown";
  const permittedPaths = stage === "build"
    ? (buildPaths.length > 0
        ? buildPaths
        : ["src/product/domain.ts", "src/product/App.tsx", "src/product/product.test.tsx", "src/product/styles.css"])
    : stage === "tests"
      ? (defaultAppSmokeFailed
          ? ["src/product/App.tsx"]
          : testingLibraryFailure
            ? ["src/product/App.tsx", "src/product/product.test.tsx"]
            : testPaths.some((candidate) => candidate !== "src/product/product.test.tsx")
              ? testPaths
              : ["src/product/domain.ts", "src/product/product.test.tsx"])
      : stage === "startup"
        ? (startupPaths.length > 0 ? startupPaths : ["src/product/App.tsx"])
        : ["src/product/domain.ts", "src/product/App.tsx", "src/product/product.test.tsx"];
  const relevantEvidence = stage === "build"
    ? `## Production build failures\n\n${buildLog}`
    : stage === "tests"
      ? `## Failed test assertions\n\n${testFailures}\n\n## Product test log\n\n${compactTestLog(testLog, testFailures)}`
      : stage === "startup"
        ? `## Development startup failures\n\n${startupLog}`
        : rawLogs.map(({ label, content }) => `## ${label}\n\n${content}`).join("\n\n");
  const evidence = [
    `## Repair stage\n\n${stage}`,
    `## Permitted repair paths\n\n${permittedPaths.map((candidate) => `- ${candidate}`).join("\n")}`,
    relevantEvidence,
  ]
    .join("\n\n")
    .replaceAll(outputDirectory, "<generated-app>");
  const signature = evidence
    .replace(ANSI_ESCAPE, "")
    .split(/\r?\n/u)
    .filter((line) => /(?:\bFAIL\b|\berror TS\d+\b|AssertionError|TestingLibraryElementError|\bError:|\s×\s)/u.test(line))
    .map((line) => line.replace(/:\d+(?::\d+)?/gu, ":<line>").trim())
    .join("\n");
  const sourceFingerprint = await fingerprintSources(outputDirectory, permittedPaths);
  return {
    key: createHash("sha256").update(`${signature || evidence}\nsource:${sourceFingerprint}`).digest("hex"),
    sourceFingerprint,
    evidence,
    stage,
    permittedPaths,
  };
}

function compactTestLog(log: string, failures: string): string {
  const clean = log.replace(ANSI_ESCAPE, "");
  // Keep unstructured/suite/runtime failures: they may not have an assertion in
  // the JSON report. Full logs and reports remain retained in every run.
  if (failures.startsWith("(") || /Unhandled|Failed Suites|Error during|unhandled/iu.test(clean)) return clean;
  if (clean.length <= 1_500) return clean;
  const locations = [...new Set(clean.split(/\r?\n/u).filter((line) => /(?:\bat |❯).*src\/product\//u.test(line)))];
  return ["Repeated assertion/DOM output omitted; the grouped JSON diagnostics above retain every failed test. Full app-test.log remains in the verification artifacts.", ...locations].join("\n");
}
