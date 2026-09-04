import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as piRunner from "../src/pi-runner.js";
import { interpreterThinkingFromEnvironment, runProductSpecInterpretation } from "../src/product-spec/interpreter.js";
import { timeoutFromEnvironment } from "../src/run-challenge.js";
import { SAMPLE_IDEA } from "./fixtures/product-spec.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("selected generation defaults", () => {
  it("uses the selected run ceiling while retaining valid explicit timeout overrides", () => {
    vi.stubEnv("CHALLENGE_TIMEOUT_MS", undefined);
    expect(timeoutFromEnvironment()).toBe(5_400_000);
    vi.stubEnv("CHALLENGE_TIMEOUT_MS", "3000");
    expect(timeoutFromEnvironment()).toBe(3000);
    vi.stubEnv("CHALLENGE_TIMEOUT_MS", "999");
    expect(() => timeoutFromEnvironment()).toThrow("at least 1000");
  });

  it("uses high interpretation by default and preserves explicit stage and fallback overrides", () => {
    vi.stubEnv("CHALLENGE_INTERPRETER_THINKING", undefined);
    vi.stubEnv("CHALLENGE_THINKING", undefined);
    expect(interpreterThinkingFromEnvironment()).toBe("high");
    vi.stubEnv("CHALLENGE_THINKING", "off");
    expect(interpreterThinkingFromEnvironment()).toBe("off");
    vi.stubEnv("CHALLENGE_INTERPRETER_THINKING", "max");
    expect(interpreterThinkingFromEnvironment()).toBe("max");
    vi.stubEnv("CHALLENGE_INTERPRETER_THINKING", "off");
    expect(interpreterThinkingFromEnvironment()).toBe("off");
  });

  it.each([undefined, "0", "1"])("carries collection selection %s into the isolated Pi child and matching instructions", async (flag) => {
    vi.stubEnv("CHALLENGE_EXECUTABLE_COLLECTION", flag);
    vi.stubEnv("CHALLENGE_PROVIDER", undefined);
    vi.stubEnv("CHALLENGE_MODEL", undefined);
    vi.stubEnv("CHALLENGE_MAX_OUTPUT_TOKENS", undefined);
    const run = vi.spyOn(piRunner, "runPi").mockResolvedValue({
      exitCode: 0, timedOut: false, modelCalls: 0, callLimitReached: false,
      successfulToolCalls: 0, toolLimitReached: false, completedFiles: [], requiredFilesComplete: false,
    });
    const directory = await mkdtemp(path.join(os.tmpdir(), "generation-defaults-"));
    directories.push(directory);
    await runProductSpecInterpretation(SAMPLE_IDEA, directory, 1000);
    expect(run).toHaveBeenCalledTimes(1);
    const [args, , , , , environment] = run.mock.calls[0]!;
    const expected = flag === "0" ? "0" : "1";
    expect(environment!.CHALLENGE_EXECUTABLE_COLLECTION).toBe(expected);
    const prompt = args[args.indexOf("--system-prompt") + 1]!;
    expect(prompt.includes("## Executable collection")).toBe(expected === "1");
  });
});
