import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export const DEFAULT_PROVIDER = "berget";
export const DEFAULT_MODEL = "Qwen/Qwen3.8-27B-FP8";
export const DEFAULT_THINKING = "medium";

export function resolveBergetExtension(): string {
  return path.join(path.dirname(require.resolve("@bergetai/pi-provider/package.json")), "index.ts");
}

export function effectiveModel(provider: string, model: string): string {
  if (provider !== "berget" || model.startsWith("berget/")) return model;
  return `berget/${model}`;
}

export function providerPiArguments(provider: string, model: string): string[] {
  const args = ["--provider", provider, "--model", effectiveModel(provider, model)];
  if (provider === "berget") args.push("--extension", resolveBergetExtension());
  return args;
}

export function providerFromEnvironment(): { provider: string; model: string; thinking: string } {
  return {
    provider: process.env.CHALLENGE_PROVIDER ?? DEFAULT_PROVIDER,
    model: process.env.CHALLENGE_MODEL ?? DEFAULT_MODEL,
    thinking: process.env.CHALLENGE_THINKING ?? DEFAULT_THINKING,
  };
}
