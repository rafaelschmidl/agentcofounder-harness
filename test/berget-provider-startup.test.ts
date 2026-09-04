import { pathToFileURL } from "node:url";
import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { initializeBergetWithRetry } from "../solution/extensions/berget-provider.js";
import { resolveOfficialBergetExtension } from "../src/provider.js";

const installed = await import(pathToFileURL(resolveOfficialBergetExtension()).href) as {
  default: (pi: ExtensionAPI) => Promise<void>;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function api() {
  const registerProvider = vi.fn<(provider: Provider) => void>();
  return { registerProvider, pi: { registerProvider } as unknown as ExtensionAPI };
}

function catalog() {
  return new Response(JSON.stringify({ models: [
    { id: "zai-org/GLM-5.2", contextWindow: 123456, inputPricePerToken: 0.0000037, outputPricePerToken: 0.0000081 },
    { id: "custom/model", contextWindow: 54321, inputPricePerToken: 0.0000013, outputPricePerToken: 0.0000029 },
  ] }), { headers: { "content-type": "application/json" } });
}

it("recovers a transient startup GET and registers the official catalog and auth unchanged", async () => {
  vi.stubEnv("BERGET_API_URL", "https://catalog.invalid/custom");
  vi.stubEnv("BERGET_INFERENCE_URL", "https://inference.invalid/v1");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(catalog());
  vi.stubGlobal("fetch", fetch);
  const baseline = api();
  await installed.default(baseline.pi);
  const official = baseline.registerProvider.mock.calls[0]![0];

  fetch.mockReset().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(catalog());
  const recovered = api();
  const wait = vi.fn(async () => undefined);
  await initializeBergetWithRetry(recovered.pi, installed.default, wait);
  expect(fetch.mock.calls).toEqual([
    ["https://catalog.invalid/custom/v1/models/chat"],
    ["https://catalog.invalid/custom/v1/models/chat"],
  ]);
  expect(wait.mock.calls).toEqual([[500]]);
  expect(recovered.registerProvider).toHaveBeenCalledTimes(1);
  const provider = recovered.registerProvider.mock.calls[0]![0];
  expect(provider.id).toBe("berget");
  expect(provider.baseUrl).toBe("https://inference.invalid/v1");
  expect(provider.getModels()).toEqual(official.getModels());
  expect(provider.getModels().map((model) => model.id)).toEqual(["zai-org/GLM-5.2", "custom/model"]);
  expect(provider.auth.apiKey?.name).toBe(official.auth.apiKey?.name);
  expect(provider.auth.oauth?.loginLabel).toBe(official.auth.oauth?.loginLabel);

  const context = {
    ctx: { env: async (key: string) => key === "BERGET_API_KEY" ? "test-scoped-key" : undefined },
    signal: new AbortController().signal,
  } as Parameters<NonNullable<Provider["auth"]["apiKey"]>["resolve"]>[0];
  expect(await provider.auth.apiKey!.resolve(context)).toEqual(await official.auth.apiKey!.resolve(context));
  expect(await provider.auth.apiKey!.resolve(context)).toMatchObject({ auth: { apiKey: "test-scoped-key" }, source: "BERGET_API_KEY" });
});

it("bounds persistent catalog outages without registering a substitute provider", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const target = api();
  const wait = vi.fn(async () => undefined);
  await expect(initializeBergetWithRetry(target.pi, installed.default, wait))
    .rejects.toMatchObject({ message: "Berget model catalog startup failed after 3 attempts.", cause: { message: expect.stringMatching(/^Failed to fetch models: 503/u) } });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(wait.mock.calls).toEqual([[500], [1000]]);
  expect(target.registerProvider).not.toHaveBeenCalled();
});

it.each([401, 403, 404])("does not retry permanent catalog HTTP %s errors", async (status) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("unavailable", { status }));
  vi.stubGlobal("fetch", fetch);
  const target = api();
  const wait = vi.fn(async () => undefined);
  await expect(initializeBergetWithRetry(target.pi, installed.default, wait)).rejects.toThrow(`Failed to fetch models: ${status}`);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
  expect(target.registerProvider).not.toHaveBeenCalled();
});

it("does not replace malformed catalog metadata with an empty or cached catalog", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"error":"bad catalog"}'));
  vi.stubGlobal("fetch", fetch);
  const target = api();
  const wait = vi.fn(async () => undefined);
  await expect(initializeBergetWithRetry(target.pi, installed.default, wait)).rejects.toThrow("Malformed model list response");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
  expect(target.registerProvider).not.toHaveBeenCalled();
});
