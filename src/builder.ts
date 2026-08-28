import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildPlan } from "./build-plan/types.js";
import type { ProductSpec } from "./product-spec/types.js";
import { providerFromEnvironment, providerPiArguments } from "./provider.js";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SOURCE_DIRECTORY, "..");
export const DEFAULT_BUILDER_THINKING = "off";

export function builderThinkingFromEnvironment(): string {
  return process.env.CHALLENGE_BUILDER_THINKING ?? DEFAULT_BUILDER_THINKING;
}

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
    "write",
    "--system-prompt",
    `${systemPrompt.trim()}\n\n${appContext.trim()}`,
    "--session-dir",
    path.join(artifactDirectory, "sessions"),
    "--extension",
    path.join(REPOSITORY_ROOT, "solution", "extensions", "owned-paths.ts"),
    ...providerPiArguments(provider.provider, provider.model),
    "--thinking",
    builderThinkingFromEnvironment(),
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

export async function loadBuilderPrompts(
  outputDirectory: string,
  plan: BuildPlan,
): Promise<{ systemPrompt: string; appContext: string }> {
  const interfacePaths = plan.file_ownership
    .filter((entry) => entry.owner === "BLOCK" && entry.path.startsWith("src/system/"))
    .map((entry) => entry.path)
    .sort();
  const [systemPrompt, appInstructions, interfaces] = await Promise.all([
    readFile(path.join(REPOSITORY_ROOT, "solution", "builder-prompt.md"), "utf8"),
    readFile(path.join(outputDirectory, "AGENTS.md"), "utf8"),
    Promise.all(interfacePaths.map(async (relativePath) => ({
      relativePath,
      content: await readFile(path.join(outputDirectory, relativePath), "utf8"),
    }))),
  ]);
  const interfaceContext = interfaces
    .map(({ relativePath, content }) => `### ${relativePath}\n\n\`\`\`tsx\n${content.trim()}\n\`\`\``)
    .join("\n\n");
  return {
    systemPrompt,
    appContext: `${appInstructions.trim()}\n\n## Materialized system interfaces\n\n${interfaceContext}`,
  };
}
