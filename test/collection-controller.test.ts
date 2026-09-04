import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { compileProductSpec } from "../src/build-plan/compile.js";
import { materializeBuildPlan } from "../src/build-plan/materialize.js";
import { validProductSpec } from "./fixtures/product-spec.js";

const run = promisify(execFile);

describe("materialized collection controller", () => {
  it("passes observable behavior regressions using the actual compiler output", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "collection-controller-behavior-"));
    try {
      const seed = path.resolve("app-template");
      await cp(seed, directory, { recursive: true, filter: (source) => !source.split(path.sep).includes("node_modules") && !source.endsWith(`${path.sep}dist`) });
      await symlink(path.join(seed, "node_modules"), path.join(directory, "node_modules"), "dir");
      const spec = validProductSpec();
      await materializeBuildPlan(compileProductSpec(spec), spec, directory);
      await cp(path.resolve("test/fixtures/collection-controller.behavior.test.tsx"), path.join(directory, "src/test/collection-controller.behavior.test.tsx"));
      const reportPath = path.join(directory, "controller-results.json");
      await run(process.execPath, [path.join(seed, "node_modules/vitest/vitest.mjs"), "run", "src/test/collection-controller.behavior.test.tsx", "--reporter=json", `--outputFile=${reportPath}`], { cwd: directory, timeout: 12_000 });
      const report = JSON.parse(await readFile(reportPath, "utf8")) as { numPassedTests: number; numFailedTests: number };
      expect(report.numPassedTests).toBe(8);
      expect(report.numFailedTests).toBe(0);
      await run(process.execPath, [path.join(seed, "node_modules/typescript/bin/tsc"), "--noEmit"], { cwd: directory, timeout: 12_000 })
        .catch((error: { stdout?: string; stderr?: string }) => { throw new Error(`Materialized controller typecheck failed:\n${error.stdout ?? ""}${error.stderr ?? ""}`); });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 25_000);
});
