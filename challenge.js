import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const usage = "Usage: npm run challenge -- --idea-file <path>";

function parseArguments(arguments_) {
  if (arguments_.includes("--help")) {
    return { help: true };
  }

  let ideaFile;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

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

  return { help: false, ideaFile: resolve(ideaFile) };
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));

    if (options.help) {
      console.log(usage);
      return;
    }

    const file = await stat(options.ideaFile);

    if (!file.isFile()) {
      throw new Error("--idea-file must point to a file");
    }

    const idea = await readFile(options.ideaFile, "utf8");

    if (idea.trim().length === 0) {
      throw new Error("--idea-file must not be empty");
    }

    // The actual harness implementation will start behind this public boundary.
    console.log("Challenge input accepted.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`challenge: ${message}`);
    console.error(usage);
    process.exitCode = 1;
  }
}

await main();
