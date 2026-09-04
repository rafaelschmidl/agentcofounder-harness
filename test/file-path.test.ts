import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { canonicalFilePath, relativeFilePath } from "../src/file-path.js";
import { mayAgentWrite, mayWritePermittedPath } from "../solution/extensions/owned-paths.js";
import { PiFileCompletion } from "../src/pi-runner.js";

it("resolves aliases for existing and new owned files without permitting outside or protected targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "owned-file-path-"));
  try {
    const app = path.join(root, "app");
    const alias = path.join(root, "alias");
    await mkdir(app);
    await symlink(app, alias, "dir");
    await writeFile(path.join(app, "system.ts"), "protected");
    await symlink(path.join(app, "system.ts"), path.join(app, "product.ts"));
    const ownership = [
      { path: "product.ts", owner: "AGENT" as const, owner_id: "product" },
      { path: "src/new.ts", owner: "AGENT" as const, owner_id: "product" },
      { path: "system.ts", owner: "BLOCK" as const, owner_id: "foundation" },
    ];
    expect(relativeFilePath(app, path.join(alias, "src/new.ts"))).toBe("src/new.ts");
    expect(canonicalFilePath(path.join(alias, "src/new.ts"))).toBe(canonicalFilePath(path.join(app, "src/new.ts")));
    expect(mayAgentWrite(app, ownership, path.join(alias, "src/new.ts"))).toBe(true);
    expect(mayWritePermittedPath(path.join(alias, "src/new.ts"), ["src/new.ts"], app)).toBe(true);
    expect(mayWritePermittedPath(path.join(alias, "system.ts"), ["src/new.ts"], app)).toBe(false);
    expect(mayAgentWrite(app, ownership, "product.ts")).toBe(false);
    expect(mayAgentWrite(app, ownership, "../outside.ts")).toBe(false);

    const completion = new PiFileCompletion(app, ["src/new.ts"]);
    completion.observe({ assistantCall: false, stopReason: "", toolCalls: 1, toolExecutionEnded: false, toolExecutionSucceeded: false, toolExecutionStarted: true, toolCallId: "write-1", toolName: "write", toolPath: path.join(alias, "src/new.ts") });
    completion.observe({ assistantCall: false, stopReason: "", toolCalls: 0, toolExecutionEnded: true, toolExecutionSucceeded: true, toolExecutionStarted: false, toolCallId: "write-1" });
    expect(completion.complete).toBe(true);
    expect(completion.completedFiles).toEqual(["src/new.ts"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
