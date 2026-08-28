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
  const evidence = entries.join("\n\n").replaceAll(outputDirectory, "<generated-app>");
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
