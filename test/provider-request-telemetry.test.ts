import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import bergetProvider from "../solution/extensions/berget-provider.js";
import { instrumentProviderFetch } from "../src/provider-request-telemetry.js";
import { initializeProviderAllowance } from "../src/provider-allowance.js";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function fixture(run: (provider: Provider, logPath: string, requests: { headers: http.IncomingHttpHeaders; body: string }[]) => Promise<void>, guarded = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "provider-telemetry-"));
  const logPath = path.join(directory, "provider-requests.jsonl");
  const requests: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer(async (request, response) => {
    if (request.url === "/v1/models/chat") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ models: [{ id: "zai-org/GLM-5.2", contextWindow: 327680, inputPricePerToken: 0.000001, outputPricePerToken: 0.000002 }] }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += String(chunk);
    requests.push({ headers: request.headers, body });
    response.writeHead(200, { "content-type": "text/event-stream", "x-request-id": "local-provider-request-17", "x-sensitive-header": "fixture-sensitive-header" });
    response.write(`data: ${JSON.stringify({ id: "completion-17", object: "chat.completion.chunk", created: 1, model: "zai-org/GLM-5.2", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "completion-17", object: "chat.completion.chunk", created: 1, model: "zai-org/GLM-5.2", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected local HTTP address");
    vi.stubEnv("BERGET_API_URL", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("BERGET_INFERENCE_URL", `http://127.0.0.1:${address.port}/v1`);
    vi.stubEnv("SYSTEM_V0_PROVIDER_REQUEST_LOG", logPath);
    if (guarded) {
      const ledgerPath = path.join(directory, "allowance.json");
      await initializeProviderAllowance(ledgerPath, { version: 1, currency: "EUR", limit: 1, baseline_cost: 0, baseline_evidence: "local-fixture", model_id: "zai-org/GLM-5.2", context_window: 327680, input_price_per_token: 0.000001, output_price_per_token: 0.000002, requests: [] });
      vi.stubEnv("SYSTEM_V0_ALLOWANCE_LEDGER", ledgerPath);
    }
    let registered: Provider | undefined;
    await bergetProvider({ registerProvider: (provider: Provider) => { registered = provider; } } as unknown as ExtensionAPI);
    if (!registered) throw new Error("Official provider failed to register");
    await run(registered, logPath, requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

it("retains safe wire and HTTP evidence through the installed official provider without changing output or auth", async () => {
  await fixture(async (provider, logPath, requests) => {
    const model = provider.getModels()[0]!;
    expect(model.contextWindow).toBe(327680);
    const result = await provider.streamSimple(model, {
      systemPrompt: "fixture-private-system",
      messages: [{ role: "user", content: "fixture-private-prompt", timestamp: 1 }],
    }, { apiKey: "fixture-private-key", maxTokens: 64, maxRetries: 0 }).result();
    expect(result.stopReason).toBe("stop");
    expect(result.usage.totalTokens).toBe(11);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.authorization).toBe("Bearer fixture-private-key");
    const wire = JSON.parse(requests[0]!.body);
    expect(wire.max_completion_tokens).toBe(64);
    const text = await readFile(logPath, "utf8");
    const events = text.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual(["request_started", "response_headers", "response_body_completed"]);
    expect(new Set(events.map((event) => event.local_request_id)).size).toBe(1);
    expect(events[0]).toMatchObject({ request_body_bytes: Buffer.byteLength(requests[0]!.body), output_token_cap: 64 });
    expect(events[1]).toMatchObject({ status: 200, provider_request_id: "local-provider-request-17" });
    for (const secret of ["fixture-private-system", "fixture-private-prompt", "fixture-private-key", "fixture-sensitive-header", "127.0.0.1"]) expect(text).not.toContain(secret);
  });
}, 20_000);

it("uses and durably settles the shared guard through the installed official provider", async () => {
  await fixture(async (provider, logPath, requests) => {
    const result = await provider.streamSimple(provider.getModels()[0]!, {
      messages: [{ role: "user", content: "fixture-private-prompt", timestamp: 1 }],
    }, { apiKey: "fixture-private-key", maxTokens: 64, maxRetries: 0 }).result();
    expect(result.stopReason).toBe("stop");
    expect(requests).toHaveLength(1);
    const ledger = JSON.parse(await readFile(path.join(path.dirname(logPath), "allowance.json"), "utf8"));
    expect(ledger.requests).toHaveLength(1);
    expect(ledger.requests[0]).toMatchObject({ status: "measured", output_token_cap: 64, reserved_cost: 0.327808, input_tokens: 10, output_tokens: 1, cost_total: 0.000012 });
    const events = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(events.find((event) => event.event === "allowance_usage_confirmed")).toMatchObject({ input_tokens_including_cache: 10, output_tokens: 1 });
  }, true);
}, 20_000);

it("logs the installed official provider's effective high effort for requested low, and none for off", async () => {
  await fixture(async (provider, logPath, requests) => {
    const model = provider.getModels()[0]!;
    expect(model.thinkingLevelMap).toMatchObject({ off: "none", low: null, high: "high", max: "max" });
    const context = { messages: [{ role: "user" as const, content: "fixture-private-prompt", timestamp: 1 }] };
    const low = await provider.streamSimple(model, context, { apiKey: "fixture-private-key", maxTokens: 64, maxRetries: 0, reasoning: "low" }).result();
    // Pi represents an effective off level by omitting the SDK reasoning option.
    const off = await provider.streamSimple(model, context, { apiKey: "fixture-private-key", maxTokens: 64, maxRetries: 0 }).result();
    expect([low.stopReason, off.stopReason]).toEqual(["stop", "stop"]);
    expect(requests.map((request) => JSON.parse(request.body).reasoning_effort)).toEqual(["high", "none"]);
    const text = await readFile(logPath, "utf8");
    const starts = text.trim().split("\n").map((line) => JSON.parse(line)).filter((event) => event.event === "request_started");
    expect(starts.map((event) => event.wire_reasoning_effort)).toEqual(["high", "none"]);
    expect(starts.every((event) => event.wire_thinking_enabled === null && event.wire_template_thinking_enabled === null)).toBe(true);
    expect(text).not.toContain("fixture-private");
  });
}, 20_000);

it("retains only allowlisted reasoning labels and boolean thinking flags", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "provider-control-telemetry-"));
  try {
    const logPath = path.join(directory, "requests.jsonl");
    const fetch = instrumentProviderFetch(async () => new Response(null, { status: 204 }), logPath);
    await fetch("http://fixture.invalid", { body: JSON.stringify({ reasoning_effort: "fixture-private-effort", thinking: { type: "enabled", content: "fixture-private-thinking" }, chat_template_kwargs: { enable_thinking: false, reasoning_effort: "max", secret: "fixture-private-secret" } }) });
    const text = await readFile(logPath, "utf8");
    expect(JSON.parse(text.split("\n")[0]!)).toMatchObject({ wire_reasoning_effort: null, wire_thinking_enabled: true, wire_template_reasoning_effort: "max", wire_template_thinking_enabled: false });
    expect(text).not.toContain("fixture-private");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("records the original connection cause before the installed SDK normalizes it, with exactly one transport attempt", async () => {
  await fixture(async (provider, logPath, requests) => {
    const cause = Object.assign(new Error("Connect Timeout Error timed out: fixture-private-cause"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    const transport = vi.fn<typeof globalThis.fetch>(async () => { throw new TypeError("fetch failed: fixture-private-message", { cause }); });
    const result = await provider.streamSimple(provider.getModels()[0]!, {
      messages: [{ role: "user", content: "fixture-private-prompt", timestamp: 1 }],
    }, { apiKey: "fixture-private-key", maxTokens: 32, fetch: transport, maxRetries: 0 }).result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Request timed out.");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(0);
    const text = await readFile(logPath, "utf8");
    const events = text.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual(["request_started", "request_failed"]);
    expect(events[1]).toMatchObject({ phase: "before_response_headers", errors: [{ name: "TypeError" }, { name: "Error", code: "UND_ERR_CONNECT_TIMEOUT" }] });
    expect(text).not.toContain("fixture-private");
  });
}, 20_000);

it("captures safe SSE error labels across split UTF8 chunks before the installed SDK cancels an in-flight stream", async () => {
  await fixture(async (provider, logPath) => {
    const raw = new TextEncoder().encode(
      `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "fixture-private-café 🔒" }, finish_reason: null }] })}\r\n\r\n`
      + `event: error\r\ndata: ${JSON.stringify({ error: { code: "server_error", type: "fixture-private-type", message: "fixture-private-message 🔒" } })}\r\n\r\n`,
    );
    let offset = 0;
    const cancelled = vi.fn();
    const transport: typeof globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        // Split every multibyte character and SSE boundary; keep a pending read after the error.
        if (offset < raw.length) controller.enqueue(raw.slice(offset, ++offset));
        else return new Promise<void>(() => {});
      },
      cancel: cancelled,
    }), { headers: { "content-type": "text/event-stream" } });
    const result = await provider.streamSimple(provider.getModels()[0]!, {
      messages: [{ role: "user", content: "fixture-private-prompt", timestamp: 1 }],
    }, { apiKey: "fixture-private-key", maxTokens: 64, fetch: transport, maxRetries: 0 }).result();
    expect(result.stopReason).toBe("error");
    expect(result.usage.totalTokens).toBe(0);
    await vi.waitFor(async () => {
      const ledger = JSON.parse(await readFile(path.join(path.dirname(logPath), "allowance.json"), "utf8"));
      expect(ledger.requests[0]).toMatchObject({ status: "unknown", cost_total: 0.327808 });
    });
    const text = await readFile(logPath, "utf8");
    const events = text.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.filter((event) => event.event === "provider_sse_error")).toHaveLength(1);
    expect(events.find((event) => event.event === "provider_sse_error")).toMatchObject({ error_envelope_present: true, named_error_event: true, code: "server_error", type: "unrecognized" });
    expect(events.filter((event) => /^response_body_(completed|failed|cancelled)$/u.test(event.event)).map((event) => event.event)).toEqual(["response_body_cancelled"]);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(text).not.toContain("fixture-private");
  }, true);
}, 20_000);

it("does not turn a response-body failure into completion or hide the original error", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "provider-body-telemetry-"));
  try {
    const logPath = path.join(directory, "requests.jsonl");
    const error = Object.assign(new Error("fixture-private-message"), { code: "UND_ERR_BODY_TIMEOUT" });
    let pulls = 0;
    const fetch = instrumentProviderFetch(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { if (pulls++ === 0) controller.enqueue(new TextEncoder().encode("partial")); else controller.error(error); },
    }), { status: 200 }), logPath);
    const response = await fetch("http://fixture.invalid", { body: "{}", method: "POST" });
    await expect(response.text()).rejects.toBe(error);
    const text = await readFile(logPath, "utf8");
    const events = text.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual(["request_started", "response_headers", "response_body_failed"]);
    expect(events[2]).toMatchObject({ phase: "after_response_headers", response_bytes: 7, errors: [{ name: "Error", code: "UND_ERR_BODY_TIMEOUT" }] });
    expect(text).not.toContain("fixture-private-message");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
