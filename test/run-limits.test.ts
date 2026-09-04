import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPiEnvironment } from "../src/pi-environment.js";
import { runLimitsFromEnvironment } from "../src/run-limits.js";

const execute = promisify(execFile);
afterEach(() => vi.unstubAllEnvs());

describe("configurable response output limit", () => {
  it("preserves the default and rejects malformed or unsupported limits", () => {
    expect(runLimitsFromEnvironment({})).toEqual({ max_provider_responses: 32, max_output_tokens_per_response: 8192, max_total_output_tokens: 262144 });
    expect(runLimitsFromEnvironment({ CHALLENGE_MAX_OUTPUT_TOKENS: "1" }).max_output_tokens_per_response).toBe(1);
    for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "32769", " 8192", "8e3"]) {
      expect(() => runLimitsFromEnvironment({ CHALLENGE_MAX_OUTPUT_TOKENS: value })).toThrow("CHALLENGE_MAX_OUTPUT_TOKENS");
    }
  });

  it.each([16384, 32768])("reports the same %i cap that Pi receives, without invoking a provider", async (cap) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "response-limit-"));
    vi.stubEnv("CHALLENGE_MAX_OUTPUT_TOKENS", String(cap));
    vi.stubEnv("CHALLENGE_MODEL", "zai-org/GLM-5.2");
    try {
      const { stdout } = await execute(process.execPath, ["--import", "tsx", "src/run-challenge.ts", "--print-run-limits", "--idea-file", path.join(directory, "does-not-exist.txt")], { cwd: path.resolve("."), env: process.env });
      const reported = JSON.parse(stdout) as ReturnType<typeof runLimitsFromEnvironment>;
      await createPiEnvironment(directory);
      const models = JSON.parse(await readFile(path.join(directory, "pi-state/models.json"), "utf8"));
      expect(models.providers.berget.modelOverrides["zai-org/GLM-5.2"].maxTokens).toBe(reported.max_output_tokens_per_response);
      expect(reported).toEqual({ max_provider_responses: 32, max_output_tokens_per_response: cap, max_total_output_tokens: 32 * cap });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects invalid configuration before reading the idea or preparing Pi state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "invalid-response-limit-"));
    vi.stubEnv("CHALLENGE_MAX_OUTPUT_TOKENS", "32769");
    try {
      await expect(execute(process.execPath, ["--import", "tsx", "src/run-challenge.ts", "--idea-file", path.join(directory, "does-not-exist.txt")], { cwd: path.resolve("."), env: process.env }))
        .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("CHALLENGE_MAX_OUTPUT_TOKENS") });
      await expect(createPiEnvironment(path.join(directory, "stage"))).rejects.toThrow("CHALLENGE_MAX_OUTPUT_TOKENS");
      await expect(stat(path.join(directory, "stage"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
