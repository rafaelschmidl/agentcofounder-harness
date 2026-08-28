import { readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FileOwnership } from "../../src/build-plan/types.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the owned-path builder`);
  return value;
}

export function mayAgentWrite(appRoot: string, ownership: FileOwnership[], candidate: string): boolean {
  const absolute = path.resolve(appRoot, candidate);
  const relative = path.relative(appRoot, absolute).split(path.sep).join("/");
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return ownership.some((entry) => entry.owner === "AGENT" && entry.path === relative);
}

export function mayWritePermittedPath(candidate: string, permittedPaths?: readonly string[]): boolean {
  return permittedPaths === undefined || permittedPaths.includes(candidate.split(path.sep).join("/"));
}

export default function ownedPaths(pi: ExtensionAPI) {
  const appRoot = process.cwd();
  const ownership = JSON.parse(
    readFileSync(requiredEnvironment("SYSTEM_V0_OWNERSHIP_FILE"), "utf8"),
  ) as FileOwnership[];
  const permittedPaths = process.env.SYSTEM_V0_PERMITTED_PATHS
    ? JSON.parse(process.env.SYSTEM_V0_PERMITTED_PATHS) as string[]
    : undefined;

  pi.on("tool_call", async (event, context) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
    const candidate = String((event.input as Record<string, unknown>).path ?? "");
    if (mayAgentWrite(appRoot, ownership, candidate) && mayWritePermittedPath(candidate, permittedPaths)) {
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
