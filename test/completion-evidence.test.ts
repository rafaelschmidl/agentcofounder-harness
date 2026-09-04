import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureRequiredArtifacts, incompleteRequiredArtifacts, reconcileJourneyTests, verifyGeneratedApp } from "../src/verify-app.js";
import { diagnoseVerification } from "../src/run-challenge.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true }))); });

describe("generated artifact evidence", () => {
  it("rejects unchanged, comment-only, missing and symbolic-link artifacts", async () => {
    const app = await mkdtemp(path.join(os.tmpdir(), "acf-completion-"));
    directories.push(app);
    await mkdir(path.join(app, "src/product"), { recursive: true });
    const file = "src/product/styles.css";
    await writeFile(path.join(app, file), "/* Product-specific visual composition belongs here. */\n");
    const artifacts = await captureRequiredArtifacts(app, [file]);
    expect(await incompleteRequiredArtifacts(app, artifacts)).toEqual([file]);
    await writeFile(path.join(app, file), "/* Styling will be added later. */\n");
    expect(await incompleteRequiredArtifacts(app, artifacts)).toEqual([file]);
    await writeFile(path.join(app, file), ":root { --accent: #224477; }\n");
    expect(await incompleteRequiredArtifacts(app, artifacts)).toEqual([]);
    await rm(path.join(app, file));
    expect(await incompleteRequiredArtifacts(app, artifacts)).toEqual([file]);
    await writeFile(path.join(app, "other.css"), "body { color: black; }\n");
    await symlink(path.join(app, "other.css"), path.join(app, file));
    expect(await incompleteRequiredArtifacts(app, artifacts)).toEqual([file]);
  });

  it("fails before executing commands and directs missing CSS repair to that file", async () => {
    const app = await mkdtemp(path.join(os.tmpdir(), "acf-missing-style-"));
    directories.push(app);
    const artifactsDirectory = path.join(app, "artifacts");
    await mkdir(artifactsDirectory);
    const result = await verifyGeneratedApp(app, artifactsDirectory, {
      requiredArtifacts: [{ path: "src/product/styles.css", seed: "/* pending */" }],
      journeys: [{ id: "journey_create" }],
      npmCommand: "must-not-be-launched",
    });
    expect(result.passed).toBe(false);
    expect(result.incompleteFiles).toEqual(["src/product/styles.css"]);
    expect(result.checks[0]?.command).toBe("harness:required-artifacts");
    const diagnosis = await diagnoseVerification(artifactsDirectory, app, result);
    expect(diagnosis.permittedPaths).toEqual(["src/product/styles.css"]);
    expect(diagnosis.evidence).toContain("Write their complete implementation");
    expect(diagnosis.evidence).not.toContain("- src/product/domain.ts");
  });
});

describe("executed journey evidence", () => {
  const journeys = [{ id: "journey_create" }, { id: "journey_return" }];
  it("requires exact ID tags and cannot infer coverage from aggregate success or a smoke test", () => {
    const report = { success: true, numPassedTests: 2, testResults: [{ assertionResults: [
      { fullName: "compiled application smoke contract", status: "passed" },
      { fullName: "[journey_create_extra] creates", status: "passed" },
    ] }] };
    expect(reconcileJourneyTests(report, journeys).map((journey) => journey.result)).toEqual(["failed", "failed"]);
  });

  it("tracks passing, failed and skipped tests independently, including multiple tags", () => {
    const report = { testResults: [{ assertionResults: [
      { fullName: "[journey_create] [journey_return] round trip", status: "passed" },
      { fullName: "[journey_return] repeated return", status: "pending" },
    ] }] };
    const results = reconcileJourneyTests(report, journeys);
    expect(results.map((journey) => journey.result)).toEqual(["passed", "failed"]);
    expect(results[1]?.testNames).toHaveLength(2);
    expect(reconcileJourneyTests(undefined, journeys).every((journey) => journey.result === "failed")).toBe(true);
  });

  it("supports IDs in named suites when Vitest supplies ancestor titles", () => {
    const report = { testResults: [{ assertionResults: [{ ancestorTitles: ["[journey_create]"], title: "saves a complete record", status: "passed" }] }] };
    expect(reconcileJourneyTests(report, journeys)[0]?.result).toBe("passed");
  });
});
