import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectRepairDiagnosis, hasCompletedRepairResponse, MAX_REPAIR_CYCLES } from "../src/repair.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("diagnosed repair", () => {
  it("groups repeated selector diagnostics while retaining every journey, distinct expectation, and runtime error", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "repair-grouped-evidence-"));
    directories.push(directory);
    const verification = path.join(directory, "verification");
    const output = path.join(directory, "app");
    await mkdir(verification);
    const duplicate = "TestingLibraryElementError: Found multiple elements with the role button and name Add";
    const snapshot = `\n\nIgnored nodes: comments, script, style\n<body>${"<div>Repeated DOM</div>".repeat(200)}</body>`;
    await writeFile(path.join(verification, "app-test-results.json"), JSON.stringify({
      testResults: [{ assertionResults: [
        ...["journey_create", "journey_persist"].map((id, index) => ({
          fullName: `[${id}] completes its workflow`, title: "completes its workflow", status: "failed",
          failureMessages: [`${duplicate}${snapshot}\n    at ${output}/src/product/product.test.tsx:${50 + index}:2`],
        })),
        { title: "count remains unchanged", status: "failed", failureMessages: ["AssertionError: expected 2 to be 1\nExpected: 1\nReceived: 2"] },
      ] }],
    }));
    const repeatedLog = `${duplicate}${snapshot}\n${duplicate}${snapshot}`;
    await writeFile(path.join(verification, "app-test.log"), repeatedLog);
    const compact = await collectRepairDiagnosis(verification, output, { tests: true });
    expect(compact.evidence.match(/TestingLibraryElementError:/gu)).toHaveLength(1);
    expect(compact.evidence).toContain("[journey_create]");
    expect(compact.evidence).toContain("[journey_persist]");
    expect(compact.evidence).toContain("product.test.tsx:50:2");
    expect(compact.evidence).toContain("product.test.tsx:51:2");
    expect(compact.evidence).toContain("Expected: 1\nReceived: 2");
    expect(compact.evidence).toContain("Full app-test.log remains");
    expect(compact.permittedPaths).toEqual(["src/product/App.tsx", "src/product/product.test.tsx"]);
    await writeFile(path.join(verification, "app-test.log"), `${repeatedLog}\nUnhandled Errors\nQuotaExceededError: storage write rejected`);
    const runtime = await collectRepairDiagnosis(verification, output, { tests: true });
    expect(runtime.evidence).toContain("QuotaExceededError: storage write rejected");
    expect(runtime.key).not.toBe(compact.key);
  });

  it("leaves an unattempted diagnosis retryable after setup or transport failures", () => {
    const event = (stopReason: string) => JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason } });
    expect(hasCompletedRepairResponse("")).toBe(false);
    expect(hasCompletedRepairResponse("provider startup failed\n")).toBe(false);
    expect(hasCompletedRepairResponse(event("error"))).toBe(false);
    expect(hasCompletedRepairResponse(event("aborted"))).toBe(false);
    expect(hasCompletedRepairResponse(JSON.stringify({ type: "message_start", message: { role: "assistant" } }))).toBe(false);
    // A genuine no-op response still exhausts the unchanged diagnosis. A transport
    // error earlier in the same stage does not hide a completed retry.
    for (const reason of ["stop", "toolUse", "length"]) {
      expect(hasCompletedRepairResponse(`${event("error")}\n${event(reason)}`)).toBe(true);
    }
  });

  it("bounds repair cycles and hashes normalized verification evidence", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "repair-diagnosis-"));
    directories.push(directory);
    const verification = path.join(directory, "verification");
    const output = path.join(directory, "app");
    await mkdir(verification);
    await mkdir(path.join(output, "src/product"), { recursive: true });
    await writeFile(path.join(output, "src/product/App.tsx"), "export default function App() { return null; }\n", "utf8");
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
    expect(MAX_REPAIR_CYCLES).toBe(7);
    expect(first).toEqual(repeated);
    expect(first.evidence).toContain("<generated-app>/src/product/App.tsx failed");
    expect(first.evidence).toContain("uses a unique priority label");
    expect(first.evidence).toContain("Found multiple elements");
    expect(first.stage).toBe("tests");
    expect(first.permittedPaths).toEqual(["src/product/App.tsx", "src/product/product.test.tsx"]);
    expect(first.key).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u);

    await writeFile(path.join(output, "src/product/App.tsx"), "export default function App() { return <main />; }\n", "utf8");
    const afterSourceChange = await collectRepairDiagnosis(verification, output);
    expect(afterSourceChange.sourceFingerprint).not.toBe(first.sourceFingerprint);
    expect(afterSourceChange.key).not.toBe(first.key);
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

  it("allows both application and test repairs for Testing Library failures", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "repair-pathless-test-"));
    directories.push(directory);
    const verification = path.join(directory, "verification");
    const output = path.join(directory, "app");
    await mkdir(verification);
    await writeFile(path.join(verification, "app-test.log"), "tests failed\n", "utf8");
    await writeFile(path.join(verification, "app-test-results.json"), JSON.stringify({
      testResults: [{ assertionResults: [{
        title: "ambiguous priority",
        status: "failed",
        failureMessages: ["TestingLibraryElementError: Found multiple elements with the text of: Priority"],
      }] }],
    }), "utf8");
    await writeFile(path.join(verification, "app-build.log"), "build passed\n", "utf8");
    await writeFile(path.join(verification, "app-dev.log"), "startup passed\n", "utf8");

    const diagnosis = await collectRepairDiagnosis(verification, output);
    expect(diagnosis.stage).toBe("tests");
    expect(diagnosis.permittedPaths).toEqual(["src/product/App.tsx", "src/product/product.test.tsx"]);
  });

  it("allows domain and test repairs for pathless value assertions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "repair-domain-assertion-"));
    directories.push(directory);
    const verification = path.join(directory, "verification");
    const output = path.join(directory, "app");
    await mkdir(verification);
    await writeFile(path.join(verification, "app-test.log"), "tests failed\n", "utf8");
    await writeFile(path.join(verification, "app-test-results.json"), JSON.stringify({
      testResults: [{ assertionResults: [{
        title: "removes zero-quantity cart lines",
        status: "failed",
        failureMessages: ["AssertionError: expected 1 to be 0 at src/product/product.test.tsx:42:12"],
      }] }],
    }), "utf8");
    await writeFile(path.join(verification, "app-build.log"), "build passed\n", "utf8");
    await writeFile(path.join(verification, "app-dev.log"), "startup passed\n", "utf8");

    const diagnosis = await collectRepairDiagnosis(verification, output);
    expect(diagnosis.permittedPaths).toEqual(["src/product/domain.ts", "src/product/product.test.tsx"]);
  });

  it("routes compiler-owned default-App smoke failures to product App code", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "repair-app-smoke-"));
    directories.push(directory);
    const verification = path.join(directory, "verification");
    const output = path.join(directory, "app");
    await mkdir(verification);
    await writeFile(path.join(verification, "app-test.log"), "tests failed\n", "utf8");
    await writeFile(path.join(verification, "app-test-results.json"), JSON.stringify({
      testResults: [{ assertionResults: [{
        title: "renders the default App without React runtime errors",
        status: "failed",
        failureMessages: ["Maximum update depth exceeded at src/system/app-smoke.test.tsx"],
      }] }],
    }), "utf8");
    await writeFile(path.join(verification, "app-build.log"), "build passed\n", "utf8");
    await writeFile(path.join(verification, "app-dev.log"), "startup passed\n", "utf8");

    const diagnosis = await collectRepairDiagnosis(verification, output);
    expect(diagnosis.stage).toBe("tests");
    expect(diagnosis.permittedPaths).toEqual(["src/product/App.tsx"]);
  });
});
