import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureSourceCheckpoint, restoreSourceCheckpoint, sourceIsReady } from "../src/source-checkpoint.js";
import { composeResult, productReport } from "../src/result.js";
import { unavailableAppVerification } from "../src/verify-app.js";
import type { AppVerification, UsageSummary } from "../src/types.js";
import type { FileOwnership } from "../src/build-plan/types.js";
import { validProductSpec } from "./fixtures/product-spec.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const ownership: FileOwnership[] = [
  { path: "src/product/App.tsx", owner: "AGENT", owner_id: "product" },
  { path: "src/product/styles.css", owner: "AGENT", owner_id: "product" },
  { path: "src/product/product.test.tsx", owner: "AGENT", owner_id: "product" },
  { path: "src/system/domain.ts", owner: "BLOCK", owner_id: "domain" },
  { path: "src/main.tsx", owner: "LINKER", owner_id: "linker" },
  { path: "result.json", owner: "LINKER", owner_id: "linker" },
];
const ready: AppVerification = {
  passed: false, readiness: { complete: true, build: true, startup: true },
  checks: [
    { command: "/custom/test-executable", journey: "Generated tests", result: "failed" },
    { command: "/custom/build-executable", journey: "Build", result: "passed" },
    { command: "/custom/start-executable", journey: "Startup", result: "passed" },
  ],
  journeys: [
    { id: "journey_add_note", result: "passed", testNames: ["[journey_add_note] saves"], diagnostic: "passed" },
    { id: "journey_validate_note", result: "failed", testNames: ["[journey_validate_note] rejects blank"], diagnostic: "still fails" },
  ],
};
const broken: AppVerification = {
  ...ready, readiness: { complete: true, build: false, startup: true },
  checks: [...ready.checks, { command: "build", journey: "A repair broke the build", result: "failed" }],
};
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "acf-source-checkpoint-")); roots.push(root);
  const app = path.join(root, "app");
  await mkdir(path.join(app, "src/product"), { recursive: true });
  await mkdir(path.join(app, "src/system"), { recursive: true });
  const originals = new Map<string, Buffer>();
  for (const file of ownership.filter((file) => file.path !== "result.json")) {
    const bytes = Buffer.from(`// ${file.path}\r\nexport const value = "café 🕯";\n`);
    originals.set(file.path, bytes); await writeFile(path.join(app, file.path), bytes);
  }
  const checkpoint = await captureSourceCheckpoint(app, path.join(root, "checkpoints"), ownership, 2, ready);
  if (!checkpoint) throw new Error("Expected ready checkpoint");
  return { root, app, checkpoint, originals };
}

describe("verified source checkpoints", () => {
  it("restores byte-identical AGENT files together, retaining broken sources and prior failed journeys", async () => {
    const { root, app, checkpoint, originals } = await fixture();
    await writeFile(path.join(app, "src/product/App.tsx"), "broken duplicate declaration");
    await writeFile(path.join(app, "src/product/styles.css"), "changed alongside repair");
    await rm(path.join(app, "src/product/product.test.tsx"));
    const directory = path.join(root, "regression");
    const result = await restoreSourceCheckpoint(app, directory, checkpoint, 3, broken);
    expect(result.restored).toBe(true);
    for (const [file, bytes] of originals) expect(await readFile(path.join(app, file))).toEqual(bytes);
    expect(await readFile(path.join(directory, "source/src/product/App.tsx"), "utf8")).toBe("broken duplicate declaration");
    expect(JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")).verification).toEqual(broken);
    expect(result.verification.journeys).toEqual(ready.journeys);
    expect(result.verification.checks.at(-1)).toMatchObject({ command: "harness:repair-regression", result: "failed" });
    const report = productReport(validProductSpec(), result.verification);
    expect(report.status).toBe("partial");
    expect(report.tests_run.map((entry) => entry.result)).toEqual(["passed", "failed"]);
    const usage: UsageSummary = { model_calls: 1, input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 2, reasoning_tokens: 0, cost_total: 0, call_log: [] };
    const port = { preexisting_listener: false, listener_after_pi: false, attempted: false, reclaimed: false, process_ids: [], diagnostic: "closed" };
    expect(composeResult(report, usage, 0, result.verification, port, "npm run dev").status).toBe("partial");
    expect(composeResult(report, usage, 143, result.verification, port, "npm run dev").status).toBe("failed");
  });

  it.each(["src/system/domain.ts", "src/main.tsx", "result.json"])("refuses every replacement when protected %s changes or appears", async (protectedPath) => {
    const { root, app, checkpoint } = await fixture();
    await writeFile(path.join(app, "src/product/App.tsx"), "broken latest");
    await writeFile(path.join(app, protectedPath), "protected mismatch");
    const result = await restoreSourceCheckpoint(app, path.join(root, "regression"), checkpoint, 3, broken);
    expect(result.restored).toBe(false);
    expect(result.diagnostic).toContain(protectedPath);
    expect(await readFile(path.join(app, "src/product/App.tsx"), "utf8")).toBe("broken latest");
    expect(await readFile(path.join(app, protectedPath), "utf8")).toBe("protected mismatch");
  });

  it("refuses corrupted checkpoint bytes and retains the latest candidate", async () => {
    const { root, app, checkpoint } = await fixture();
    await writeFile(path.join(checkpoint.directory, "source/src/product/App.tsx"), "tampered");
    await writeFile(path.join(app, "src/product/App.tsx"), "latest broken");
    const result = await restoreSourceCheckpoint(app, path.join(root, "regression"), checkpoint, 3, broken);
    expect(result.restored).toBe(false);
    expect(result.diagnostic).toContain("checkpoint:src/product/App.tsx");
    expect(await readFile(path.join(app, "src/product/App.tsx"), "utf8")).toBe("latest broken");
  });

  it("does not follow a replacement destination symlink", async () => {
    const { root, app, checkpoint } = await fixture();
    const target = path.join(root, "outside.txt"); await writeFile(target, "untouched");
    await rm(path.join(app, "src/product/App.tsx")); await symlink(target, path.join(app, "src/product/App.tsx"));
    const result = await restoreSourceCheckpoint(app, path.join(root, "regression"), checkpoint, 3, broken);
    expect(result.restored).toBe(false);
    expect(await readFile(target, "utf8")).toBe("untouched");
  });

  it("never uses generated test counts as a reason to restore a still-ready later candidate", async () => {
    const { root, app, checkpoint } = await fixture();
    await writeFile(path.join(app, "src/product/App.tsx"), "latest builds but tests fail");
    const latest = { ...ready, journeys: ready.journeys!.map((journey) => ({ ...journey, result: "failed" as const })) };
    const result = await restoreSourceCheckpoint(app, path.join(root, "regression"), checkpoint, 3, latest);
    expect(result.restored).toBe(false);
    expect(result.verification).toBe(latest);
    expect(await readFile(path.join(app, "src/product/App.tsx"), "utf8")).toBe("latest builds but tests fail");
    expect(await captureSourceCheckpoint(app, path.join(root, "checkpoints"), ownership, 3, latest)).toMatchObject({ attempt: 3 });
  });

  it("preserves a ready checkpoint after an interrupted unverified repair without certifying the run", async () => {
    const { root, app, checkpoint } = await fixture();
    await writeFile(path.join(app, "src/product/App.tsx"), "half written");
    const result = await restoreSourceCheckpoint(app, path.join(root, "regression"), checkpoint, 3, unavailableAppVerification("repair timed out"));
    expect(result.restored).toBe(true);
    expect(result.verification.passed).toBe(false);
    expect(result.verification.journeys?.find((journey) => journey.result === "failed")).toBeDefined();
  });

  it("requires explicit completeness, build and startup readiness, independently of aggregate pass", async () => {
    expect(sourceIsReady(ready)).toBe(true);
    for (const readiness of [undefined, { complete: false, build: true, startup: true }, { complete: true, build: false, startup: true }, { complete: true, build: true, startup: false }]) {
      const verification: AppVerification = { ...ready, passed: true };
      if (readiness) verification.readiness = readiness; else delete verification.readiness;
      expect(sourceIsReady(verification)).toBe(false);
      expect(await captureSourceCheckpoint("/unused", "/unused", ownership, 0, verification)).toBeUndefined();
    }
  });
});
