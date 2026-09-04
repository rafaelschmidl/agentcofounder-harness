import { realpathSync } from "node:fs";
import path from "node:path";

/** Resolve existing aliases while retaining missing leaf paths for new writes. */
export function canonicalFilePath(file: string): string {
  const absolute = path.resolve(file);
  try { return realpathSync.native(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) return absolute;
    return path.join(canonicalFilePath(parent), path.basename(absolute));
  }
}

export function relativeFilePath(root: string, candidate: string): string {
  return path.relative(canonicalFilePath(root), canonicalFilePath(path.resolve(root, candidate)))
    .split(path.sep).join("/");
}
