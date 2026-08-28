import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInterpreterPiArguments } from "../src/product-spec/interpreter.js";
import { segmentIdea } from "../src/product-spec/fragments.js";
import { submitProductSpecCandidate } from "../src/product-spec/submit.js";
import { SAMPLE_IDEA, validProductSpec } from "./fixtures/product-spec.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("ProductSpec interpreter boundary", () => {
  it("enables only offline retrieval and submission tools", () => {
    const previous = {
      provider: process.env.CHALLENGE_PROVIDER,
      model: process.env.CHALLENGE_MODEL,
      thinking: process.env.CHALLENGE_THINKING,
    };
    delete process.env.CHALLENGE_PROVIDER;
    delete process.env.CHALLENGE_MODEL;
    delete process.env.CHALLENGE_THINKING;
    try {
      const args = buildInterpreterPiArguments(
        SAMPLE_IDEA,
        segmentIdea(SAMPLE_IDEA),
        "Interpret product scope.",
        "/tmp/system-v0-run",
      );
      expect(args).toContain("--print");
      expect(args).toContain("--offline");
      expect(args).toContain("--no-builtin-tools");
      expect(args[args.indexOf("--tools") + 1]).toBe("retrieve_patterns,submit_product_spec");
      expect(args[args.indexOf("--provider") + 1]).toBe("berget");
      expect(args[args.indexOf("--model") + 1]).toBe("berget/Qwen/Qwen3.8-27B-FP8");
      expect(args.join(" ")).toContain("@bergetai/pi-provider");
      expect(args[args.indexOf("--thinking") + 1]).toBe("medium");
      expect(args.join(" ")).not.toContain("protected-paths.ts");
    } finally {
      if (previous.provider === undefined) delete process.env.CHALLENGE_PROVIDER;
      else process.env.CHALLENGE_PROVIDER = previous.provider;
      if (previous.model === undefined) delete process.env.CHALLENGE_MODEL;
      else process.env.CHALLENGE_MODEL = previous.model;
      if (previous.thinking === undefined) delete process.env.CHALLENGE_THINKING;
      else process.env.CHALLENGE_THINKING = previous.thinking;
    }
  });

  it("returns validation evidence without creating an artifact for a rejected candidate", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "product-spec-rejected-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "idea_spec.json");
    const result = await submitProductSpecCandidate("{}", SAMPLE_IDEA, segmentIdea(SAMPLE_IDEA), output);

    expect(result.accepted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes only a validated ProductSpec", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "product-spec-accepted-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "idea_spec.json");
    const spec = validProductSpec();
    const result = await submitProductSpecCandidate(
      JSON.stringify(spec),
      SAMPLE_IDEA,
      segmentIdea(SAMPLE_IDEA),
      output,
    );

    expect(result.accepted).toBe(true);
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(spec);
  });
});
