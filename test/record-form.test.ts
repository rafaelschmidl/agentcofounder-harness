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

describe("materialized RecordForm", () => {
  it("passes browser-DOM regressions using the actual compiler output and installed app runtime", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "record-form-behavior-"));
    try {
      const seed = path.resolve("app-template");
      await cp(seed, directory, {
        recursive: true,
        filter: (source) => !source.split(path.sep).includes("node_modules") && !source.endsWith(`${path.sep}dist`),
      });
      await symlink(path.join(seed, "node_modules"), path.join(directory, "node_modules"), "dir");
      const spec = validProductSpec();
      await materializeBuildPlan(compileProductSpec(spec), spec, directory);
      await cp(path.resolve("test/fixtures/record-form.behavior.test.tsx"), path.join(directory, "src/test/record-form.behavior.test.tsx"));
      const reportPath = path.join(directory, "record-form-results.json");
      await run(process.execPath, [
        path.join(seed, "node_modules/vitest/vitest.mjs"), "run", "src/test/record-form.behavior.test.tsx",
        "--reporter=json", `--outputFile=${reportPath}`,
      ], { cwd: directory, timeout: 12_000 });
      const report = JSON.parse(await readFile(reportPath, "utf8")) as { numPassedTests: number; numFailedTests: number };
      expect(report.numPassedTests).toBe(3);
      expect(report.numFailedTests).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
