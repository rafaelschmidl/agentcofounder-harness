import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { allowanceTotal, initializeProviderAllowance, markProviderRequestUnknown, reserveProviderRequest, settleProviderRequest, type ProviderAllowance } from "../src/provider-allowance.js";
import { instrumentProviderFetch } from "../src/provider-request-telemetry.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline: ProviderAllowance = { version: 1, currency: "EUR", limit: 19.48, baseline_cost: 14.954239, baseline_evidence: "retained-official-audit.json", model_id: "zai-org/GLM-5.2", context_window: 327680, input_price_per_token: 0.000001, output_price_per_token: 0.000002, requests: [] };
const request = (id: string) => ({ id, stageEvidence: "fixture-log.jsonl", modelId: baseline.model_id, contextWindow: baseline.context_window, outputTokenCap: 32768 });

async function fixture(run: (ledgerPath: string, directory: string) => Promise<void>, value = baseline) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "provider-allowance-"));
  const ledgerPath = path.join(directory, "allowance.json");
  try { await initializeProviderAllowance(ledgerPath, value); await run(ledgerPath, directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const read = async (ledgerPath: string) => JSON.parse(await readFile(ledgerPath, "utf8")) as ProviderAllowance;

it("atomically admits only one concurrent process when two reserves would exceed the allowance", async () => {
  await fixture(async (ledgerPath) => {
    const child = (id: string) => new Promise<number | null>((resolve, reject) => {
      const code = `import {reserveProviderRequest} from './src/provider-allowance.ts'; try {await reserveProviderRequest(process.argv[1], JSON.parse(process.argv[2]));} catch {process.exitCode=2;}`;
      const process = spawn(globalThis.process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, ledgerPath, JSON.stringify(request(id))], { cwd: root, stdio: "ignore" });
      process.once("error", reject); process.once("close", resolve);
    });
    expect((await Promise.all([child("first"), child("second")])).sort()).toEqual([0, 2]);
    const ledger = await read(ledgerPath);
    expect(ledger.requests).toHaveLength(1);
    expect(allowanceTotal(ledger)).toBe(15.347455);
    expect(allowanceTotal(ledger)).toBeLessThanOrEqual(ledger.limit);
  }, { ...baseline, limit: 15.6 });
});

it("settles confirmed full prompt usage once, retains unknowns, and never resets an existing ledger", async () => {
  await fixture(async (ledgerPath) => {
    await reserveProviderRequest(ledgerPath, request("done"));
    await settleProviderRequest(ledgerPath, "done", { inputTokens: 10000, outputTokens: 1000 });
    await settleProviderRequest(ledgerPath, "done", { inputTokens: 10000, outputTokens: 1000 });
    await reserveProviderRequest(ledgerPath, request("unknown"));
    await markProviderRequestUnknown(ledgerPath, "unknown");
    const ledger = await read(ledgerPath);
    expect(ledger.requests.map((entry) => [entry.status, entry.cost_total])).toEqual([["measured", 0.012], ["unknown", 0.393216]]);
    expect(allowanceTotal(ledger)).toBe(15.359455);
    await expect(settleProviderRequest(ledgerPath, "unknown", { inputTokens: 0, outputTokens: 0 })).rejects.toThrow("incomplete");
    await expect(settleProviderRequest(ledgerPath, "done", { inputTokens: 1, outputTokens: 1 })).rejects.toThrow("Conflicting");
    await expect(initializeProviderAllowance(ledgerPath, baseline)).rejects.toThrow();
    expect(await read(ledgerPath)).toEqual(ledger);
  });
});

function wire(cap = 32768, model = baseline.model_id) {
  return { method: "POST", body: JSON.stringify({ model, messages: [{ role: "user", content: "fixture-secret" }], max_completion_tokens: cap }) };
}

function sse(usage: unknown, errorAfterDone = false): Response {
  const payload = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`);
  let emitted = false;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (!emitted) { emitted = true; controller.enqueue(payload); }
    else if (errorAfterDone) controller.error(new Error("transport failed after terminal marker"));
    else controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}

it("settles only this request's complete HTTP metering, including cached prompt input exactly once", async () => {
  await fixture(async (ledgerPath, directory) => {
    const fetch = instrumentProviderFetch(async () => sse({ prompt_tokens: 10000, completion_tokens: 1000, total_tokens: 11000, prompt_tokens_details: { cached_tokens: 9000 } }), path.join(directory, "requests.jsonl"), { path: ledgerPath, modelId: baseline.model_id, contextWindow: baseline.context_window });
    await (await fetch("http://fixture.invalid", wire())).text();
    expect((await read(ledgerPath)).requests[0]).toMatchObject({ status: "measured", input_tokens: 10000, output_tokens: 1000, cost_total: 0.012 });
  });
});

it("retains whole reservations for missing usage, failed streams, and timeouts without inventing zero spend", async () => {
  await fixture(async (ledgerPath, directory) => {
    const responses = [() => sse(undefined), () => sse({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }, true), () => { throw new TypeError("fetch failed"); }];
    for (const next of responses) {
      const fetch = instrumentProviderFetch(async () => next(), path.join(directory, "requests.jsonl"), { path: ledgerPath, modelId: baseline.model_id, contextWindow: baseline.context_window });
      try { await (await fetch("http://fixture.invalid", wire())).text(); } catch { /* Original transport failure remains visible. */ }
    }
    const ledger = await read(ledgerPath);
    expect(ledger.requests).toHaveLength(3);
    expect(ledger.requests.every((entry) => entry.status === "unknown" && entry.cost_total === 0.393216)).toBe(true);
  });
});

it("cancels an in-flight read once without inventing provider EOF or losing its unknown allowance", async () => {
  await fixture(async (ledgerPath, directory) => {
    let signalRead!: () => void;
    const reading = new Promise<void>((resolve) => { signalRead = resolve; });
    const cancelled = vi.fn();
    const source = new ReadableStream<Uint8Array>({
      pull() { signalRead(); return new Promise<void>(() => {}); },
      cancel: cancelled,
    });
    const logPath = path.join(directory, "requests.jsonl");
    const fetch = instrumentProviderFetch(async () => new Response(source), logPath, { path: ledgerPath, modelId: baseline.model_id, contextWindow: baseline.context_window });
    const response = await fetch("http://fixture.invalid", wire());
    const reader = response.body!.getReader();
    const pendingRead = reader.read();
    await reading;
    await reader.cancel("fixture consumer cancellation");
    expect(await pendingRead).toEqual({ done: true, value: undefined });
    expect(cancelled).toHaveBeenCalledTimes(1);
    const events = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(events.filter((event) => /^response_body_(completed|failed|cancelled)$/u.test(event.event)).map((event) => event.event)).toEqual(["response_body_cancelled"]);
    expect(events.some((event) => event.event === "allowance_usage_confirmed")).toBe(false);
    expect((await read(ledgerPath)).requests[0]).toMatchObject({ status: "unknown", cost_total: 0.393216 });
  });
});

it("refuses missing caps, modified wire models, corrupted ledgers and exhausted allowance before HTTP", async () => {
  await fixture(async (ledgerPath, directory) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const network = vi.fn<typeof globalThis.fetch>(async () => sse({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }));
      const fetch = instrumentProviderFetch(network, path.join(directory, "requests.jsonl"), { path: ledgerPath, modelId: baseline.model_id, contextWindow: baseline.context_window });
      await expect(fetch("http://fixture.invalid", wire(0))).rejects.toThrow();
      await expect(fetch("http://fixture.invalid", wire(32768, "other/model"))).rejects.toThrow();
      await expect(fetch("http://fixture.invalid", wire())).rejects.toThrow("exhausted");
      expect(network).not.toHaveBeenCalled();
      expect((await read(ledgerPath)).requests).toEqual([]);
      await writeFile(ledgerPath, "malformed");
      await expect(fetch("http://fixture.invalid", wire())).rejects.toThrow();
      expect(network).not.toHaveBeenCalled();
      expect(await readFile(ledgerPath, "utf8")).toBe("malformed");
    } finally { vi.restoreAllMocks(); }
  }, { ...baseline, limit: 15 });
});
