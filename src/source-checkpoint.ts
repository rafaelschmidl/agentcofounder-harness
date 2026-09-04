import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileOwnership } from "./build-plan/types.js";
import type { AppVerification } from "./types.js";

type FileState = { kind: "file"; sha256: string } | { kind: "missing" } |
  { kind: "symlink"; target: string } | { kind: "non-file" };
interface CapturedFile extends FileOwnership { state: FileState }
export interface SourceCheckpoint {
  directory: string;
  attempt: number;
  verification: AppVerification;
  files: CapturedFile[];
}

export function sourceIsReady(verification: AppVerification): boolean {
  const readiness = verification.readiness;
  return readiness?.complete === true && readiness.build && readiness.startup;
}

function ownedPath(root: string, relative: string): string {
  const absolute = path.resolve(root, relative);
  const bounded = path.relative(root, absolute);
  if (!bounded || bounded.startsWith("..") || path.isAbsolute(bounded)) {
    throw new Error(`Unsafe checkpoint path: ${relative}`);
  }
  return absolute;
}

async function regularParents(root: string, relative: string): Promise<void> {
  const absolute = ownedPath(root, relative);
  for (let parent = path.dirname(absolute); parent !== path.resolve(root); parent = path.dirname(parent)) {
    if (!(await lstat(parent)).isDirectory()) throw new Error(`Non-directory checkpoint parent: ${parent}`);
  }
}

function hash(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

async function inspectFile(root: string, relative: string): Promise<{ state: FileState; bytes?: Buffer }> {
  try {
    await regularParents(root, relative);
    const file = ownedPath(root, relative);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) return { state: { kind: "symlink", target: await readlink(file) } };
    if (!stat.isFile()) return { state: { kind: "non-file" } };
    const bytes = await readFile(file);
    return { state: { kind: "file", sha256: hash(bytes) }, bytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: { kind: "missing" } };
    throw error;
  }
}

async function retainSources(
  appDirectory: string, directory: string, ownership: readonly FileOwnership[],
  attempt: number, verification: AppVerification,
): Promise<SourceCheckpoint> {
  if (new Set(ownership.map((file) => file.path)).size !== ownership.length) throw new Error("Duplicate checkpoint ownership paths");
  await mkdir(directory, { recursive: true });
  const files: CapturedFile[] = [];
  for (const entry of ownership) {
    const captured = await inspectFile(appDirectory, entry.path);
    files.push({ ...entry, state: captured.state });
    if (captured.bytes) {
      const destination = ownedPath(path.join(directory, "source"), entry.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, captured.bytes, { flag: "wx" });
    }
  }
  const checkpoint = { directory, attempt, verification: structuredClone(verification), files };
  await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(checkpoint, null, 2)}\n`, { flag: "wx" });
  return checkpoint;
}

/** Select the latest complete build/startup-passing source, regardless of generated test counts. */
export async function captureSourceCheckpoint(
  appDirectory: string, checkpointsDirectory: string, ownership: readonly FileOwnership[],
  attempt: number, verification: AppVerification,
): Promise<SourceCheckpoint | undefined> {
  if (!sourceIsReady(verification)) return undefined;
  const checkpoint = await retainSources(appDirectory, path.join(checkpointsDirectory, `attempt-${attempt}`), ownership, attempt, verification);
  if (checkpoint.files.some((file) => file.owner === "AGENT" && file.state.kind !== "file")) {
    throw new Error("A verified checkpoint no longer contains all AGENT-owned files");
  }
  if (checkpoint.files.some((file) => file.owner !== "AGENT" && file.state.kind !== "file" && file.state.kind !== "missing")) {
    throw new Error("A verified checkpoint contains a non-regular protected path");
  }
  return checkpoint;
}

/** Preflight every file before changing any destination; roll back partial renames on I/O failure. */
async function replaceAgentFiles(appDirectory: string, replacements: Array<{ path: string; bytes: Buffer }>): Promise<void> {
  const staged: Array<{ destination: string; temporary: string; previous: Buffer | undefined }> = [];
  let replaced = 0;
  try {
    for (const replacement of replacements) {
      await regularParents(appDirectory, replacement.path);
      const previous = await inspectFile(appDirectory, replacement.path);
      if (previous.state.kind !== "file" && previous.state.kind !== "missing") throw new Error(`Unsafe restore destination: ${replacement.path}`);
      const destination = ownedPath(appDirectory, replacement.path);
      const temporary = `${destination}.checkpoint-${randomUUID()}`;
      staged.push({ destination, temporary, previous: previous.bytes });
      await writeFile(temporary, replacement.bytes, { flag: "wx" });
    }
    for (const entry of staged) {
      await rename(entry.temporary, entry.destination);
      replaced += 1;
    }
  } catch (error) {
    for (const entry of staged.slice(0, replaced)) {
      if (entry.previous) await writeFile(entry.destination, entry.previous);
      else await rm(entry.destination, { force: true });
    }
    throw error;
  } finally {
    await Promise.all(staged.map((entry) => rm(entry.temporary, { force: true })));
  }
}

export async function restoreSourceCheckpoint(
  appDirectory: string, regressionDirectory: string, checkpoint: SourceCheckpoint,
  latestAttempt: number, latestVerification: AppVerification,
): Promise<{ restored: boolean; verification: AppVerification; diagnostic: string }> {
  if (sourceIsReady(latestVerification)) return { restored: false, verification: latestVerification, diagnostic: "Latest sources remain ready" };
  // Capture the rejected latest candidate before doing anything to its source files. Verification logs remain in their original attempt directories.
  const latest = await retainSources(appDirectory, regressionDirectory, checkpoint.files, latestAttempt, latestVerification);
  const mismatches: string[] = [];
  const replacements: Array<{ path: string; bytes: Buffer }> = [];
  for (const file of checkpoint.files) {
    const current = latest.files.find((entry) => entry.path === file.path)!;
    if (file.owner !== "AGENT") {
      if ((file.state.kind !== "file" && file.state.kind !== "missing") || JSON.stringify(file.state) !== JSON.stringify(current.state)) mismatches.push(file.path);
      continue;
    }
    if (file.state.kind !== "file") throw new Error(`Incomplete checkpoint: ${file.path}`);
    const saved = await inspectFile(path.join(checkpoint.directory, "source"), file.path);
    if (saved.state.kind !== "file" || saved.state.sha256 !== file.state.sha256 || !saved.bytes) {
      mismatches.push(`checkpoint:${file.path}`);
    } else if (current.state.kind !== "file" && current.state.kind !== "missing") {
      mismatches.push(`destination:${file.path}`);
    } else replacements.push({ path: file.path, bytes: saved.bytes });
  }
  let restored = false;
  let diagnostic: string;
  if (mismatches.length > 0) {
    diagnostic = `Repair lost verified readiness; refused checkpoint restoration because protected files or checkpoint bytes changed: ${mismatches.join(", ")}. Latest sources retained at ${regressionDirectory}.`;
  } else {
    await replaceAgentFiles(appDirectory, replacements);
    restored = true;
    diagnostic = `Repair lost complete build/startup verification; restored exact AGENT-owned sources from verified attempt ${checkpoint.attempt}. Its original journey results apply. Rejected attempt ${latestAttempt} sources and verification retained at ${regressionDirectory}.`;
  }
  const baseline = restored ? checkpoint.verification : latestVerification;
  const verification: AppVerification = {
    ...structuredClone(baseline), passed: false,
    checks: [...structuredClone(baseline.checks), { command: "harness:repair-regression", journey: diagnostic, result: "failed" }],
  };
  await writeFile(path.join(regressionDirectory, "restoration.json"), `${JSON.stringify({ restored, checkpoint_attempt: checkpoint.attempt, latest_attempt: latestAttempt, mismatches, diagnostic, verification }, null, 2)}\n`, { flag: "wx" });
  return { restored, verification, diagnostic };
}
