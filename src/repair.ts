import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const MAX_REPAIR_CYCLES = 7;
const MAX_LOG_CHARACTERS = 12_000;
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/gu;

export interface RepairDiagnosis {
  key: string;
  sourceFingerprint: string;
  evidence: string;
  stage: "build" | "tests" | "startup" | "unknown";
  permittedPaths: string[];
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
          status?: unknown;
          failureMessages?: unknown;
        }>;
      }>;
    };
    const failures = (report.testResults ?? [])
      .flatMap((suite) => suite.assertionResults ?? [])
      .filter((assertion) => assertion.status === "failed")
      .map((assertion) => {
        const title = typeof assertion.title === "string" ? assertion.title : "unnamed test";
        const messages = Array.isArray(assertion.failureMessages)
          ? assertion.failureMessages.filter((message): message is string => typeof message === "string")
          : [];
        return `### ${title}\n\n${messages.join("\n").slice(0, 3_000)}`;
      });
    return failures.length > 0 ? failures.join("\n\n") : "(no failed assertions in JSON report)";
  } catch {
    return "(test result JSON unavailable)";
  }
}

export async function collectRepairDiagnosis(
  verificationDirectory: string,
  outputDirectory: string,
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
  const hasBuildErrors = /error TS\d+/u.test(buildLog);
  const buildPaths = hasBuildErrors ? agentPaths(buildLog) : [];
  const assertionPaths = agentPaths(testFailures);
  const testingLibraryFailure = /TestingLibraryElementError|Unable to find|Found multiple elements/iu.test(testFailures);
  const defaultAppSmokeFailed = /compiled application smoke contract|default App without React runtime errors|app-smoke\.test\.tsx/iu
    .test(testFailures);
  const testPaths = assertionPaths.length > 0 ? assertionPaths : agentPaths(testLog);
  const startupPaths = agentPaths(startupLog);
  const stage = hasBuildErrors
    ? "build"
    : testFailures !== "(no failed assertions in JSON report)" && testFailures !== "(test result JSON unavailable)"
      ? "tests"
      : startupPaths.length > 0
        ? "startup"
        : "unknown";
  const permittedPaths = stage === "build"
    ? (buildPaths.length > 0
        ? buildPaths
        : ["src/product/domain.ts", "src/product/App.tsx", "src/product/product.test.tsx"])
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
      ? `## Failed test assertions\n\n${testFailures}\n\n## Product test log\n\n${testLog}`
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
