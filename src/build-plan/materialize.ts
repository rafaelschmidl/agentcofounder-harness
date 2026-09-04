import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { capabilityBlock } from "./blocks.js";
import type { BuildPlan, FileOwner, MaterializedFile } from "./types.js";
import type { ProductSpec } from "../product-spec/types.js";
import { BASE_UI_STYLES } from "./ui-styles.js";

function resolveOwnedPath(outputDirectory: string, relativePath: string): string {
  const absolute = path.resolve(outputDirectory, relativePath);
  const relative = path.relative(outputDirectory, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe materialization path: ${relativePath}`);
  }
  return absolute;
}

async function writeDeterministicFile(outputDirectory: string, file: MaterializedFile): Promise<void> {
  const absolute = resolveOwnedPath(outputDirectory, file.path);
  await mkdir(path.dirname(absolute), { recursive: true });
  let previous: string | undefined;
  try {
    previous = await readFile(absolute, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (previous === file.content) return;
  await writeFile(absolute, file.content, "utf8");
}

async function writeAgentSeed(outputDirectory: string, file: MaterializedFile): Promise<void> {
  const absolute = resolveOwnedPath(outputDirectory, file.path);
  await mkdir(path.dirname(absolute), { recursive: true });
  try {
    await writeFile(absolute, file.content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

function assertOwner(plan: BuildPlan, file: string, owner: FileOwner, ownerId: string): void {
  const entry = plan.file_ownership.find((candidate) => candidate.path === file);
  if (!entry || entry.owner !== owner || entry.owner_id !== ownerId) {
    throw new Error(`${file} is not owned by ${owner}:${ownerId}`);
  }
}

function agentSeeds(plan: BuildPlan): MaterializedFile[] {
  return [
    ...(plan.file_ownership.some(entry => entry.path === "src/product/interaction-manifest.json") ? [{path: "src/product/interaction-manifest.json", content: '{"version":1,"filters":[],"counts":[],"journeys":[],"unsupported":[]}\n'}] : []),
    {
      path: "src/product/App.tsx",
      content: `import { PRODUCT_NAME } from "../system/product";
import { AppShell, EmptyState } from "../system/ui";

export default function App() {
  return (
    <AppShell title={PRODUCT_NAME} subtitle="Product customization is pending">
      <EmptyState title="Preparing your workspace">The product-specific interface has not been generated yet.</EmptyState>
    </AppShell>
  );
}
`,
    },
    {
      path: "src/product/domain.ts",
      content: `// Product-specific entities and domain operations belong in this file.
export const PRODUCT_DOMAIN_READY = false;
`,
    },
    {
      path: "src/product/product.test.tsx",
      content: `import { describe, it } from "vitest";

describe("product journeys", () => {
  it.todo("replace this placeholder with observable acceptance-journey tests");
});
`,
    },
    {
      path: "src/product/styles.css",
      content: `/* Product-specific visual composition belongs here. */
`,
    },
  ];
}

export async function materializeBuildPlan(
  plan: BuildPlan,
  _spec: ProductSpec,
  outputDirectory: string,
): Promise<string[]> {
  const files: MaterializedFile[] = [];
  for (const planned of plan.blocks) {
    const block = capabilityBlock(planned.id);
    if (!block) throw new Error(`Cannot materialize unknown block ${planned.id}`);
    const blockFiles = block.materialize(planned.config);
    for (const file of blockFiles) {
      assertOwner(plan, file.path, "BLOCK", block.id);
      files.push(file);
    }
  }
  for (const file of agentSeeds(plan)) {
    const ownership = plan.file_ownership.find((candidate) => candidate.path === file.path);
    if (ownership?.owner === "BLOCK") continue;
    if (!ownership || ownership.owner !== "AGENT") throw new Error(`Missing AGENT ownership for ${file.path}`);
    await writeAgentSeed(outputDirectory, file);
  }
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new Error("Materializers produced duplicate file paths");
  }
  await Promise.all(files.map((file) => writeDeterministicFile(outputDirectory, file)));
  return [...files.map((file) => file.path), ...agentSeeds(plan).filter((file) => plan.file_ownership.some((entry) => entry.path === file.path && entry.owner === "AGENT")).map((file) => file.path)].sort();
}

export async function writeCompilerArtifacts(
  plan: BuildPlan,
  spec: ProductSpec,
  outputDirectory: string,
): Promise<string[]> {
  const ownership = [...plan.file_ownership].sort((left, right) => left.path.localeCompare(right.path));
  const files: MaterializedFile[] = [
    { path: "idea_spec.json", content: `${JSON.stringify(spec, null, 2)}\n` },
    { path: "build_plan.json", content: `${JSON.stringify(plan, null, 2)}\n` },
    { path: "file_ownership.json", content: `${JSON.stringify(ownership, null, 2)}\n` },
  ];
  for (const file of files) assertOwner(plan, file.path, "LINKER", "deterministic_linker");
  await Promise.all(files.map((file) => writeDeterministicFile(outputDirectory, file)));
  return files.map((file) => file.path).sort();
}

export async function linkBuildPlan(plan: BuildPlan, spec: ProductSpec, outputDirectory: string): Promise<string[]> {
  const files: MaterializedFile[] = [
    { path: "src/App.tsx", content: `export { default } from "./product/App";\n` },
    {
      path: "src/main.tsx",
      content: `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import "./product/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
    },
    {
      path: "src/styles.css",
      content: BASE_UI_STYLES,
    },
  ];
  for (const file of files) assertOwner(plan, file.path, "LINKER", "deterministic_linker");
  await Promise.all(files.map((file) => writeDeterministicFile(outputDirectory, file)));
  const artifactPaths = await writeCompilerArtifacts(plan, spec, outputDirectory);
  return [...files.map((file) => file.path), ...artifactPaths].sort();
}
