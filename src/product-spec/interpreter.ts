import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPi, type CommandResult } from "../pi-runner.js";
import { providerFromEnvironment, providerPiArguments } from "../provider.js";
import { createPiEnvironment } from "../pi-environment.js";
import { hashIdea, segmentIdea } from "./fragments.js";
import type { ProductSpec, SourceFragment } from "./types.js";
import { validateProductSpec } from "./validate.js";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SOURCE_DIRECTORY, "../..");

export interface ProductSpecInterpretationResult {
  command: CommandResult;
  spec?: ProductSpec;
  errors: string[];
  files: {
    idea: string;
    fragments: string;
    productSpec: string;
    patternAudit: string;
    events: string;
    stderr: string;
  };
}

export function buildInterpreterPiArguments(
  idea: string,
  fragments: SourceFragment[],
  systemPrompt: string,
  artifactDirectory: string,
): string[] {
  const provider = providerFromEnvironment();
  const args = [
    "--mode",
    "json",
    "--print",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-builtin-tools",
    "--tools",
    "retrieve_patterns,submit_product_spec",
    "--system-prompt",
    systemPrompt.trim(),
    "--session-dir",
    path.join(artifactDirectory, "sessions"),
    "--extension",
    path.join(REPOSITORY_ROOT, "solution", "extensions", "product-spec-interpreter.ts"),
    ...providerPiArguments(provider.provider, provider.model),
    "--thinking",
    provider.thinking,
    [
      "## Raw product idea",
      idea,
      "",
      `## Source idea hash\n${hashIdea(idea)}`,
      "",
      "## Immutable source fragments",
      JSON.stringify(fragments, null, 2),
      "",
      "Retrieve relevant patterns, then submit the complete ProductSpec v0.1.",
    ].join("\n"),
  ];
  return args;
}

export async function runProductSpecInterpretation(
  idea: string,
  artifactDirectory: string,
  timeoutMs: number,
): Promise<ProductSpecInterpretationResult> {
  const files = {
    idea: path.join(artifactDirectory, "idea.txt"),
    fragments: path.join(artifactDirectory, "source_fragments.json"),
    productSpec: path.join(artifactDirectory, "idea_spec.json"),
    patternAudit: path.join(artifactDirectory, "pattern-retrieval.jsonl"),
    events: path.join(artifactDirectory, "interpreter.events.jsonl"),
    stderr: path.join(artifactDirectory, "interpreter.stderr.log"),
  };
  const fragments = segmentIdea(idea);
  const systemPrompt = await readFile(path.join(REPOSITORY_ROOT, "solution", "interpreter-prompt.md"), "utf8");
  await mkdir(path.join(artifactDirectory, "sessions"), { recursive: true });
  await Promise.all([
    writeFile(files.idea, idea, { encoding: "utf8", flag: "wx" }),
    writeFile(files.fragments, `${JSON.stringify(fragments, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
    writeFile(files.patternAudit, "", { encoding: "utf8", flag: "wx" }),
  ]);

  const environment = await createPiEnvironment(artifactDirectory, {
    SYSTEM_V0_IDEA_FILE: files.idea,
    SYSTEM_V0_FRAGMENTS_FILE: files.fragments,
    SYSTEM_V0_PRODUCT_SPEC_FILE: files.productSpec,
    SYSTEM_V0_PATTERN_AUDIT_FILE: files.patternAudit,
  });
  const command = await runPi(
    buildInterpreterPiArguments(
      idea,
      fragments,
      systemPrompt,
      artifactDirectory,
    ),
    REPOSITORY_ROOT,
    files.events,
    files.stderr,
    timeoutMs,
    environment,
  );

  let candidate: unknown;
  try {
    candidate = JSON.parse(await readFile(files.productSpec, "utf8")) as unknown;
  } catch (error) {
    return {
      command,
      errors: [`interpreter did not produce a readable idea_spec.json: ${(error as Error).message}`],
      files,
    };
  }
  const validation = validateProductSpec(candidate, idea, fragments);
  if (!validation.spec) return { command, errors: validation.errors, files };
  return { command, spec: validation.spec, errors: validation.errors, files };
}
