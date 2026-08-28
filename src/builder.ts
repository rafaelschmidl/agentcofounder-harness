import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildPlan } from "./build-plan/types.js";
import type { ProductSpec } from "./product-spec/types.js";
import { providerFromEnvironment, providerPiArguments } from "./provider.js";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SOURCE_DIRECTORY, "..");

export function buildBuilderPiArguments(
  spec: ProductSpec,
  plan: BuildPlan,
  systemPrompt: string,
  appContext: string,
  artifactDirectory: string,
): string[] {
  const provider = providerFromEnvironment();
  return [
    "--mode",
    "json",
    "--print",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--tools",
    "read,write,edit",
    "--system-prompt",
    `${systemPrompt.trim()}\n\n${appContext.trim()}`,
    "--session-dir",
    path.join(artifactDirectory, "sessions"),
    "--extension",
    path.join(REPOSITORY_ROOT, "solution", "extensions", "owned-paths.ts"),
    ...providerPiArguments(provider.provider, provider.model),
    "--thinking",
    provider.thinking,
    [
      "## Validated ProductSpec",
      JSON.stringify(spec, null, 2),
      "",
      "## Deterministic BuildPlan",
      JSON.stringify(plan, null, 2),
      "",
      "Implement the AGENT-owned product files now.",
    ].join("\n"),
  ];
}

export async function loadBuilderPrompts(outputDirectory: string): Promise<{ systemPrompt: string; appContext: string }> {
  const [systemPrompt, appContext] = await Promise.all([
    readFile(path.join(REPOSITORY_ROOT, "solution", "builder-prompt.md"), "utf8"),
    readFile(path.join(outputDirectory, "AGENTS.md"), "utf8"),
  ]);
  return { systemPrompt, appContext };
}
