import { describe, expect, it } from "vitest";
import { effectiveModel, providerPiArguments, resolveBergetExtension } from "../src/provider.js";

describe("provider seam", () => {
  it("loads the approved Berget extension and namespaces its model", () => {
    expect(resolveBergetExtension()).toMatch(/@bergetai\/pi-provider\/index\.ts$/u);
    expect(effectiveModel("berget", "Qwen/Qwen3.8-27B-FP8")).toBe("berget/Qwen/Qwen3.8-27B-FP8");
    expect(providerPiArguments("berget", "Qwen/Qwen3.8-27B-FP8")).toEqual([
      "--provider",
      "berget",
      "--model",
      "berget/Qwen/Qwen3.8-27B-FP8",
      "--extension",
      resolveBergetExtension(),
    ]);
  });

  it("leaves non-Berget providers and models unchanged", () => {
    expect(effectiveModel("openai", "gpt-example")).toBe("gpt-example");
    expect(providerPiArguments("openai", "gpt-example")).toEqual([
      "--provider",
      "openai",
      "--model",
      "gpt-example",
    ]);
  });
});
