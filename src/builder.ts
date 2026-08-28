import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildPlan } from "./build-plan/types.js";
import type { ProductSpec } from "./product-spec/types.js";
import { providerFromEnvironment, providerPiArguments } from "./provider.js";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SOURCE_DIRECTORY, "..");
const AGENT_PRODUCT_PATHS = [
  "src/product/domain.ts",
  "src/product/App.tsx",
  "src/product/product.test.tsx",
  "src/product/styles.css",
] as const;
export const DEFAULT_BUILDER_THINKING = "high";

export function builderThinkingFromEnvironment(): string {
  return process.env.CHALLENGE_BUILDER_THINKING ?? DEFAULT_BUILDER_THINKING;
}

export function buildBuilderPiArguments(
  spec: ProductSpec,
  plan: BuildPlan,
  systemPrompt: string,
  appContext: string,
  artifactDirectory: string,
  taskInstruction = "Implement the AGENT-owned product files now.",
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
      taskInstruction,
    ].join("\n"),
  ];
}

export function buildRepairPiArguments(
  spec: ProductSpec,
  plan: BuildPlan,
  systemPrompt: string,
  appContext: string,
  artifactDirectory: string,
  attempt: number,
  permittedPaths: readonly string[] = AGENT_PRODUCT_PATHS,
): string[] {
  const provider = providerFromEnvironment();
  const requirements = spec.requirements
    .filter((requirement) => requirement.disposition === "IMPLEMENT")
    .map((requirement) => `- ${requirement.id}: ${requirement.title}`)
    .join("\n");
  return [
    "--mode", "json", "--print", "--offline", "--no-extensions", "--no-skills",
    "--no-prompt-templates", "--no-themes", "--no-context-files", "--tools", "write,edit",
    "--system-prompt", `${systemPrompt.trim()}\n\n${appContext.trim()}`,
    "--session-dir", path.join(artifactDirectory, "sessions"),
    "--extension", path.join(REPOSITORY_ROOT, "solution", "extensions", "owned-paths.ts"),
    ...providerPiArguments(provider.provider, provider.model),
    "--thinking", builderThinkingFromEnvironment(),
    [
      `Repair attempt ${attempt}.`,
      `Product: ${spec.product.summary}`,
      "Implemented requirements:",
      requirements,
      "Deterministically permitted paths:",
      permittedPaths.map((candidate) => `- ${candidate}`).join("\n"),
      "Address only the supplied failure evidence, then stop.",
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

export async function loadRepairPrompts(
  outputDirectory: string,
  plan: BuildPlan,
  diagnosis: string,
): Promise<{ systemPrompt: string; appContext: string }> {
  const [base, systemPrompt, agentSources] = await Promise.all([
    loadBuilderPrompts(outputDirectory, plan),
    readFile(path.join(REPOSITORY_ROOT, "solution", "repair-prompt.md"), "utf8"),
    Promise.all(AGENT_PRODUCT_PATHS.map(async (relativePath) => ({
      relativePath,
      content: await readFile(path.join(outputDirectory, relativePath), "utf8"),
    }))),
  ]);
  const currentSources = agentSources
    .map(({ relativePath, content }) => `### ${relativePath}\n\n\`\`\`tsx\n${content.trim()}\n\`\`\``)
    .join("\n\n");
  return {
    systemPrompt,
    appContext: `${base.appContext}\n\n## Current AGENT-owned sources\n\n${currentSources}\n\n## Deterministic failure evidence\n\n${diagnosis}`,
  };
}
