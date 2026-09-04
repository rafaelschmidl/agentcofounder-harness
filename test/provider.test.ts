import { describe, expect, it } from "vitest";
import { effectiveModel, providerPiArguments, resolveBergetExtension, resolveOfficialBergetExtension } from "../src/provider.js";

describe("provider seam", () => {
  it("loads the approved Berget extension and namespaces its model", () => {
    expect(resolveBergetExtension()).toMatch(/solution\/extensions\/berget-provider\.ts$/u);
    expect(resolveOfficialBergetExtension()).toMatch(/@bergetai\/pi-provider\/index\.ts$/u);
    expect(effectiveModel("berget", "zai-org/GLM-5.2")).toBe("berget/zai-org/GLM-5.2");
    expect(providerPiArguments("berget", "zai-org/GLM-5.2")).toEqual([
      "--provider",
      "berget",
      "--model",
      "berget/zai-org/GLM-5.2",
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
