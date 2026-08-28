import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const MAX_REPAIR_CYCLES = 2;
const MAX_LOG_CHARACTERS = 12_000;
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/gu;

export interface RepairDiagnosis {
  key: string;
  evidence: string;
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
  const entries = await Promise.all(logs.map(
    async ([label, filename]) => `## ${label}\n\n${await readLogTail(path.join(verificationDirectory, filename))}`,
  ));
  const testFailures = await readTestFailures(path.join(verificationDirectory, "app-test-results.json"));
  const evidence = [`## Failed test assertions\n\n${testFailures}`, ...entries]
    .join("\n\n")
    .replaceAll(outputDirectory, "<generated-app>");
  const signature = evidence
    .replace(ANSI_ESCAPE, "")
    .split(/\r?\n/u)
    .filter((line) => /(?:\bFAIL\b|\berror TS\d+\b|AssertionError|TestingLibraryElementError|\bError:|\s×\s)/u.test(line))
    .map((line) => line.replace(/:\d+(?::\d+)?/gu, ":<line>").trim())
    .join("\n");
  return {
    key: createHash("sha256").update(signature || evidence).digest("hex"),
    evidence,
  };
}
