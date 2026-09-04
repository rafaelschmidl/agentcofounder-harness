import { readFileSync } from "node:fs";
import path from "node:path";
import { createWriteToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FileOwnership } from "../../src/build-plan/types.js";
import { canonicalFilePath, relativeFilePath } from "../../src/file-path.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the owned-path builder`);
  return value;
}

export function mayAgentWrite(appRoot: string, ownership: FileOwnership[], candidate: string): boolean {
  const relative = relativeFilePath(appRoot, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return ownership.some((entry) => entry.owner === "AGENT" && entry.path === relative);
}

export function mayWritePermittedPath(candidate: string, permittedPaths?: readonly string[], appRoot = process.cwd()): boolean {
  return permittedPaths === undefined || permittedPaths.includes(relativeFilePath(appRoot, candidate));
}

/** Keep the native write semantics, but finish a complete builder inside Pi. */
export function createCompletingWriteTool(appRoot: string, ownership: readonly FileOwnership[]) {
  const required = new Set(ownership.filter((entry) => entry.owner === "AGENT").map((entry) => canonicalFilePath(path.resolve(appRoot, entry.path))));
  const completed = new Set<string>();
  const write = createWriteToolDefinition(appRoot);
  return {
    ...write,
    async execute(...args: Parameters<typeof write.execute>) {
      const absolute = canonicalFilePath(path.resolve(appRoot, args[1].path));
      args[1] = { ...args[1], path: absolute };
      const result = await write.execute(...args);
      if (required.has(absolute)) completed.add(absolute);
      const remaining = [...required].filter((candidate) => !completed.has(candidate))
        .map((candidate) => relativeFilePath(appRoot, candidate));
      return {
        ...result,
        content: [...result.content, {
          type: "text" as const,
          text: remaining.length > 0
            ? `After this write, required files still missing: ${remaining.join(", ")}. Complete these before polishing already-written files; verification follows completion.`
            : "All required product files have been written. Returning to deterministic verification after this batch.",
        }],
        // Pi evaluates every result's termination flag after the full batch has
        // drained. A getter lets earlier successful writes observe completion
        // by later writes without stopping a batch before its final correction.
        // The installed-runtime test guards this native SDK contract.
        get terminate() {
          return required.size > 0 && completed.size === required.size;
        },
      };
    },
  };
}

export default function ownedPaths(pi: ExtensionAPI) {
  const appRoot = process.cwd();
  const ownership = JSON.parse(
    readFileSync(requiredEnvironment("SYSTEM_V0_OWNERSHIP_FILE"), "utf8"),
  ) as FileOwnership[];
  const permittedPaths = process.env.SYSTEM_V0_PERMITTED_PATHS
    ? JSON.parse(process.env.SYSTEM_V0_PERMITTED_PATHS) as string[]
    : undefined;

  // Repairs may revisit completed files and hand back explicitly. They must not
  // inherit the initial builder's distinct-file completion rule.
  if (permittedPaths === undefined) pi.registerTool(createCompletingWriteTool(appRoot, ownership));

  pi.on("tool_call", async (event, context) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
    const candidate = String((event.input as Record<string, unknown>).path ?? "");
    if (mayAgentWrite(appRoot, ownership, candidate) && mayWritePermittedPath(candidate, permittedPaths, appRoot)) {
      return undefined;
    }
    if (context.hasUI) context.ui.notify(`Blocked non-agent-owned write: ${candidate}`, "warning");
    return {
      block: true,
      reason: permittedPaths
        ? `This repair may edit only: ${permittedPaths.join(", ")}`
        : "The builder may edit only AGENT-owned files declared by BuildPlan",
    };
  });
}
