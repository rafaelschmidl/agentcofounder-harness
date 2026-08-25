import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeConfiguredPi } from "./src/execution.js";
import { readRuntimeConfiguration, validateQualificationEnvironment } from "./src/config.js";
import { redactText } from "./src/evidence.js";
import { defaultWorkspaceRoot, prepareWorkspace } from "./src/workspace.js";

const usage = "Usage: npm run qualification -- --prompt-file <path>";
const root = dirname(fileURLToPath(import.meta.url));

export function parseQualificationArguments(arguments_) {
  if (arguments_.includes("--help")) return { help: true };
  if (arguments_.length !== 2 || arguments_[0] !== "--prompt-file" || !arguments_[1]) {
    throw new Error("--prompt-file is required exactly once");
  }
  return { help: false, promptFile: resolve(arguments_[1]) };
}

async function main() {
  let execution;
  try {
    const options = parseQualificationArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage);
      return;
    }
    validateQualificationEnvironment(process.env);
    const promptStat = await stat(options.promptFile);
    if (!promptStat.isFile()) throw new Error("--prompt-file must point to a file");
    const prompt = await readFile(options.promptFile, "utf8");
    if (prompt.trim() === "") throw new Error("--prompt-file must not be empty");
    if (prompt.includes(process.env.QUALIFICATION_NONCE)) {
      throw new Error("qualification prompt must not contain QUALIFICATION_NONCE");
    }
    const configuration = readRuntimeConfiguration(process.env, { requireCredential: true });
    const workspaceRoot = await prepareWorkspace(defaultWorkspaceRoot());
    execution = await executeConfiguredPi({
      environment: process.env,
      configuration,
      prompt,
      workspaceRoot,
      qualification: true,
      qualificationExtension: resolve(root, "test-fixtures", "qualification-nonce-extension.ts"),
    });
    if (execution.result.code !== 0 || execution.result.timedOut) {
      const detail = redactText(
        execution.result.stderr.trim() || execution.result.stdout.trim(),
        execution.secrets,
      );
      throw new Error(`Pi qualification failed${detail ? `: ${detail}` : ""}`);
    }
    console.log(JSON.stringify({ status: "qualified", workspace: workspaceRoot }));
  } catch (error) {
    console.error(
      `qualification: ${redactText(error instanceof Error ? error.message : String(error), execution?.secrets ?? [])}`,
    );
    console.error(usage);
    process.exitCode = 1;
  }
}

await main();
