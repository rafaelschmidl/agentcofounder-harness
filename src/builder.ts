import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { BuildPlan } from "./build-plan/types.js";
import { foundationDesignContext } from "./build-plan/foundation-context.js";
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
export const DEFAULT_BUILDER_THINKING = "off";

export function builderThinkingFromEnvironment(): string {
  return process.env.CHALLENGE_BUILDER_THINKING ?? DEFAULT_BUILDER_THINKING;
}

/** The builder needs executable meaning, not repeated source quotes and compiler bookkeeping. */
export function builderExecutionContext(spec: ProductSpec, plan: BuildPlan) {
  return {
    product: spec.product,
    requirements: spec.requirements.map(({ source_refs: _sources, provenance: _provenance, ...requirement }) => requirement),
    entities: spec.entities,
    workflows: spec.workflows,
    persistence: spec.persistence,
    integrations: spec.integrations,
    views: spec.views,
    acceptance_journeys: spec.acceptance_journeys,
    assumptions: spec.assumptions,
    exclusions: spec.exclusions,
    resolved_conflicts: spec.conflicts.map(({ description, resolution }) => ({ description, resolution })),
    build: {
      blocks: plan.blocks.map(({ id, config }) => ({ id, config })),
      custom_slots: plan.custom_slots,
      owned_paths: plan.file_ownership.filter((entry) => entry.owner === "AGENT").map((entry) => entry.path),
      routes: plan.routes,
      exports: plan.exports,
      verification_obligations: plan.verification_obligations,
      install_allowed: plan.dependencies.install_allowed,
    },
  };
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
      "## Validated ProductSpec and BuildPlan — execution context",
      "The complete source-provenance artifacts remain on disk. This projection preserves all product behavior, exclusions, interfaces, and verification obligations needed for implementation.",
      JSON.stringify(builderExecutionContext(spec, plan)),
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
    "--no-prompt-templates", "--no-themes", "--no-context-files", "--tools", "write,edit,finish_repair",
    "--system-prompt", `${systemPrompt.trim()}\n\n${appContext.trim()}`,
    "--session-dir", path.join(artifactDirectory, "sessions"),
    "--extension", path.join(REPOSITORY_ROOT, "solution", "extensions", "owned-paths.ts"),
    "--extension", path.join(REPOSITORY_ROOT, "solution", "extensions", "repair-completion.ts"),
    ...providerPiArguments(provider.provider, provider.model),
    "--thinking", builderThinkingFromEnvironment(),
    [
      `Repair attempt ${attempt}.`,
      `Product: ${spec.product.summary}`,
      "Implemented requirements:",
      requirements,
      "Deterministically permitted paths:",
      permittedPaths.map((candidate) => `- ${candidate}`).join("\n"),
      "Address only the supplied failure evidence, then call finish_repair to obtain fresh deterministic verification. Do not continue speculative edits after that evidence is addressed.",
    ].join("\n"),
  ];
}

export async function loadBuilderPrompts(
  outputDirectory: string,
  plan: BuildPlan,
): Promise<{ systemPrompt: string; appContext: string }> {
  const compiledCollection = plan.blocks.some((block) => block.id === "domain.executable-collection");
  const compiledInterfaces = new Set(["src/system/product.ts", "src/system/ui.tsx", "src/system/record-form.tsx", "src/system/collection-controller.tsx", "src/system/test-contract.ts", "src/product/domain.ts"]);
  const interfacePaths = plan.file_ownership
    .filter((entry) => entry.owner === "BLOCK" && (compiledCollection ? compiledInterfaces.has(entry.path) : entry.path.startsWith("src/system/")))
    .map((entry) => entry.path)
    .sort();
  const [systemPrompt, appInstructions, interfaces] = await Promise.all([
    readFile(path.join(REPOSITORY_ROOT, "solution", compiledCollection ? "builder-executable-collection.md" : "builder-prompt.md"), "utf8"),
    readFile(path.join(outputDirectory, "AGENTS.md"), "utf8"),
    Promise.all(interfacePaths.map(async (relativePath) => ({
      relativePath,
      content: materializedInterfaceContext(relativePath, await readFile(path.join(outputDirectory, relativePath), "utf8")),
    }))),
  ]);
  const interfaceContext = interfaces
    .map(({ relativePath, content }) => `### ${relativePath}\n\n\`\`\`tsx\n${content.trim()}\n\`\`\``)
    .join("\n\n");
  return {
    systemPrompt,
    appContext: `${appInstructions.trim()}\n\n${foundationDesignContext()}\n\n## Materialized system interfaces\n\n${interfaceContext}`,
  };
}

function materializedInterfaceContext(relativePath: string, source: string): string {
  if (!["src/system/record-form.tsx", "src/system/collection-controller.tsx"].includes(relativePath)) return source;
  // Derive the API from the shipped implementation so optional helper guidance
  // cannot silently omit an export or lag a changed prop signature.
  const declaration = ts.transpileDeclaration(source, {
    fileName: relativePath,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, isolatedDeclarations: true },
    reportDiagnostics: true,
  });
  const errors = declaration.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length > 0) {
    throw new Error(`Cannot describe ${relativePath}: ${errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, " ")).join("; ")}`);
  }
  return `// Public declarations generated from the installed helper; implementation is already materialized.\n${declaration.outputText}`;
}

export async function loadRepairPrompts(
  outputDirectory: string,
  plan: BuildPlan,
  diagnosis: string,
  sourcePaths: readonly string[] = AGENT_PRODUCT_PATHS,
): Promise<{ systemPrompt: string; appContext: string }> {
  const [base, systemPrompt, agentSources] = await Promise.all([
    loadBuilderPrompts(outputDirectory, plan),
    readFile(path.join(REPOSITORY_ROOT, "solution", "repair-prompt.md"), "utf8"),
    Promise.all(sourcePaths.map(async (relativePath) => ({
      relativePath,
      content: await readFile(path.join(outputDirectory, relativePath), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "(This required file is missing. Create it.)";
        throw error;
      }),
    }))),
  ]);
  const currentSources = agentSources
    .map(({ relativePath, content }) => `### ${relativePath}\n\n\`\`\`tsx\n${content.trim()}\n\`\`\``)
    .join("\n\n");
  return {
    systemPrompt: plan.blocks.some((block) => block.id === "domain.executable-collection")
      ? `${systemPrompt}\n\nThe compiled domain.ts is protected. Use its definition, useProductCollection and ProductEditor API. Canonical collection state, persistence and workflow semantics belong to that module; never replace them with an alternate implementation in App. Preserve independent journey assertions when domain semantics are wrong and return control with finish_repair.`
      : systemPrompt,
    appContext: `${base.appContext}\n\n## Current AGENT-owned sources\n\n${currentSources}\n\n## Deterministic failure evidence\n\n${diagnosis}`,
  };
}
