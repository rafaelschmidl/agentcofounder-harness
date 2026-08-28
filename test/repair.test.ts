import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectRepairDiagnosis, MAX_REPAIR_CYCLES } from "../src/repair.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("diagnosed repair", () => {
  it("bounds repair cycles and hashes normalized verification evidence", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "repair-diagnosis-"));
    directories.push(directory);
    const verification = path.join(directory, "verification");
    const output = path.join(directory, "app");
    await mkdir(verification);
    await writeFile(path.join(verification, "app-test.log"), `${output}/src/product/App.tsx failed\n`, "utf8");
    await writeFile(path.join(verification, "app-build.log"), "build failed\n", "utf8");
    await writeFile(path.join(verification, "app-dev.log"), "startup passed\n", "utf8");

    const first = await collectRepairDiagnosis(verification, output);
    const repeated = await collectRepairDiagnosis(verification, output);
    expect(MAX_REPAIR_CYCLES).toBe(2);
    expect(first).toEqual(repeated);
    expect(first.evidence).toContain("<generated-app>/src/product/App.tsx failed");
    expect(first.key).toMatch(/^[a-f0-9]{64}$/u);
  });
});
