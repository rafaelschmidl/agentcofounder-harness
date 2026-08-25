import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

export function defaultWorkspaceRoot(cwd = process.cwd()) {
  return resolve(cwd, process.env.CHALLENGE_WORKSPACE || "output/app");
}

/**
 * Prepare a fresh disposable challenge workspace. This function deliberately
 * has no runtime-config or Pi imports so --prepare-only cannot start a model
 * session or read a provider credential.
 */
export async function prepareWorkspace(workspaceRoot = defaultWorkspaceRoot()) {
  const root = resolve(workspaceRoot);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}
