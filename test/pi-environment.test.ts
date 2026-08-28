import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPiEnvironment } from "../src/pi-environment.js";

describe("isolated Pi environment", () => {
  it("creates isolated state, caps Qwen output, and excludes challenge controls", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pi-environment-"));
    const previous = process.env.CHALLENGE_SECRET;
    process.env.CHALLENGE_SECRET = "must-not-pass";
    try {
      const environment = await createPiEnvironment(directory, { SYSTEM_V0_STAGE: "interpreter" });
      expect(environment.HOME).toBe(path.join(directory, "home"));
      expect(environment.CHALLENGE_SECRET).toBeUndefined();
      expect(environment.SYSTEM_V0_STAGE).toBe("interpreter");
      const models = JSON.parse(
        await readFile(path.join(directory, "pi-state", "models.json"), "utf8"),
      ) as { providers: { berget: { modelOverrides: Record<string, { maxTokens: number }> } } };
      expect(models.providers.berget.modelOverrides["Qwen/Qwen3.8-27B-FP8"]?.maxTokens).toBe(4096);
    } finally {
      if (previous === undefined) delete process.env.CHALLENGE_SECRET;
      else process.env.CHALLENGE_SECRET = previous;
      await rm(directory, { recursive: true });
    }
  });
});
