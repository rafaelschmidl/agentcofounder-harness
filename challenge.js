import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { readRuntimeConfiguration, runtimeConfigurationMetadata } from "./src/config.js";
import { executeConfiguredPi } from "./src/execution.js";
import { redactText } from "./src/evidence.js";
import { defaultWorkspaceRoot, prepareWorkspace } from "./src/workspace.js";

const usage =
  "Usage: npm run challenge -- [--prepare-only] --idea-file <path>";

export function parseArguments(arguments_) {
  if (arguments_.includes("--help")) {
    return { help: true };
  }

  let ideaFile;
  let prepareOnly = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    if (argument === "--prepare-only") {
      if (prepareOnly) throw new Error("--prepare-only may only be provided once");
      prepareOnly = true;
      continue;
    }

    if (argument !== "--idea-file") {
      throw new Error(`Unknown argument: ${argument}`);
    }

    if (ideaFile !== undefined) {
      throw new Error("--idea-file may only be provided once");
    }

    ideaFile = arguments_[index + 1];
    index += 1;

    if (ideaFile === undefined) {
      throw new Error("--idea-file requires a path");
    }
  }

  if (ideaFile === undefined) {
    throw new Error("--idea-file is required");
  }

  return { help: false, ideaFile: resolve(ideaFile), prepareOnly };
}

async function validateIdea(ideaFile) {
  const file = await stat(ideaFile);
  if (!file.isFile()) throw new Error("--idea-file must point to a file");
  const idea = await readFile(ideaFile, "utf8");
  if (idea.trim().length === 0) throw new Error("--idea-file must not be empty");
  return idea;
}

async function main() {
  let options;
  let workspaceRoot;
  let execution;

  try {
    options = parseArguments(process.argv.slice(2));

    if (options.help) {
      console.log(usage);
      return;
    }

    // This path intentionally runs before runtime configuration and Pi
    // construction. It only resets/prepares the workspace.
    if (options.prepareOnly) {
      await validateIdea(options.ideaFile);
      workspaceRoot = await prepareWorkspace(defaultWorkspaceRoot());
      console.log(JSON.stringify({ status: "prepared", workspace: workspaceRoot }));
      return;
    }

    const idea = await validateIdea(options.ideaFile);
    const configuration = readRuntimeConfiguration(process.env, { requireCredential: true });
    workspaceRoot = await prepareWorkspace(defaultWorkspaceRoot());
    execution = await executeConfiguredPi({
      environment: process.env,
      configuration,
      prompt: idea,
      workspaceRoot,
    });

    const summary = {
      status: execution.result.code === 0 && !execution.result.timedOut ? "success" : "failure",
      requestedRuntime: runtimeConfigurationMetadata(execution.configuration),
      process: {
        code: execution.result.code,
        signal: execution.result.signal,
        timedOut: execution.result.timedOut,
        durationMs: execution.result.durationMs,
      },
      workspace: workspaceRoot,
    };
    if (execution.result.code === 0 && !execution.result.timedOut) {
      console.log(JSON.stringify(summary));
      return;
    }

    const detail = redactText(
      execution.result.stderr.trim() || execution.result.stdout.trim(),
      execution.secrets,
    );
    throw new Error(
      `Pi execution failed (${execution.result.code === null ? `signal ${execution.result.signal}` : `exit ${execution.result.code}`})${detail ? `: ${detail}` : ""}`,
    );
  } catch (error) {
    const message = redactText(
      error instanceof Error ? error.message : String(error),
      execution?.secrets ?? [],
    );
    console.error(`challenge: ${message}`);
    console.error(usage);
    process.exitCode = 1;
  }
}

await main();
