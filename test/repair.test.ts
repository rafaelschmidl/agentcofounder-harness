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
    await writeFile(path.join(verification, "app-test-results.json"), JSON.stringify({
      testResults: [{ assertionResults: [{
        title: "uses a unique priority label",
        status: "failed",
        failureMessages: ["TestingLibraryElementError: Found multiple elements with the text of: Priority"],
      }] }],
    }), "utf8");
    await writeFile(path.join(verification, "app-build.log"), "build failed\n", "utf8");
    await writeFile(path.join(verification, "app-dev.log"), "startup passed\n", "utf8");

    const first = await collectRepairDiagnosis(verification, output);
    const repeated = await collectRepairDiagnosis(verification, output);
    expect(MAX_REPAIR_CYCLES).toBe(2);
    expect(first).toEqual(repeated);
    expect(first.evidence).toContain("<generated-app>/src/product/App.tsx failed");
    expect(first.evidence).toContain("uses a unique priority label");
    expect(first.evidence).toContain("Found multiple elements");
    expect(first.stage).toBe("tests");
    expect(first.permittedPaths).toEqual(["src/product/App.tsx"]);
    expect(first.key).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("prioritizes compiler errors and permits only their responsible product files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "repair-build-diagnosis-"));
    directories.push(directory);
    const verification = path.join(directory, "verification");
    const output = path.join(directory, "app");
    await mkdir(verification);
    await writeFile(path.join(verification, "app-test.log"), "tests failed\n", "utf8");
    await writeFile(path.join(verification, "app-test-results.json"), JSON.stringify({
      testResults: [{ assertionResults: [{
        title: "ambiguous priority",
        status: "failed",
        failureMessages: [`TestingLibraryElementError in ${output}/src/product/App.tsx`],
      }] }],
    }), "utf8");
    await writeFile(
      path.join(verification, "app-build.log"),
      "src/product/domain.ts(77,26): error TS4104: readonly mismatch\nsrc/product/product.test.tsx(28,7): error TS2322: bad argument\n",
      "utf8",
    );
    await writeFile(path.join(verification, "app-dev.log"), "startup passed\n", "utf8");

    const diagnosis = await collectRepairDiagnosis(verification, output);
    expect(diagnosis.stage).toBe("build");
    expect(diagnosis.permittedPaths).toEqual([
      "src/product/domain.ts",
      "src/product/product.test.tsx",
    ]);
    expect(diagnosis.evidence).toContain("error TS4104");
    expect(diagnosis.evidence).not.toContain("ambiguous priority");
  });
});
