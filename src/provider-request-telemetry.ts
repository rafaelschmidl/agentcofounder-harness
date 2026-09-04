import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { markProviderRequestUnknown, reserveProviderRequest, settleProviderRequest } from "./provider-allowance.js";
import { createProviderUsageObserver } from "./provider-usage-observer.js";

const ERROR_CODES = new Set([
  "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ABORT_ERR",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);
const ERROR_NAMES = new Set([
  "Error", "TypeError", "AbortError", "TimeoutError", "ConnectTimeoutError", "HeadersTimeoutError", "BodyTimeoutError", "SocketError",
]);
const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

function reasoningControls(payload: Record<string, unknown>): Record<string, string | boolean | null> {
  const effort = (value: unknown) => typeof value === "string" && REASONING_EFFORTS.has(value) ? value : null;
  const thinking = payload.thinking;
  const thinkingType = thinking && typeof thinking === "object" && "type" in thinking ? thinking.type : undefined;
  const template = payload.chat_template_kwargs && typeof payload.chat_template_kwargs === "object"
    ? payload.chat_template_kwargs as Record<string, unknown> : {};
  // Only known control labels and booleans are evidence; never serialize arbitrary nested payload values.
  return {
    wire_reasoning_effort: effort(payload.reasoning_effort),
    wire_thinking_enabled: typeof thinking === "boolean" ? thinking : thinkingType === "enabled" ? true : thinkingType === "disabled" ? false : null,
    wire_template_reasoning_effort: effort(template.reasoning_effort),
    wire_template_thinking_enabled: typeof template.enable_thinking === "boolean" ? template.enable_thinking : null,
  };
}

/** Capture transport causes before the OpenAI SDK replaces them with a generic timeout. */
function errorKinds(error: unknown): { name: string; code?: string }[] {
  const result: { name: string; code?: string }[] = [];
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error) && result.length < 5) {
    seen.add(error);
    const value = error as { name?: unknown; code?: unknown; cause?: unknown };
    result.push({
      name: typeof value.name === "string" && ERROR_NAMES.has(value.name) ? value.name : "OtherError",
      ...(typeof value.code === "string" && ERROR_CODES.has(value.code) ? { code: value.code } : {}),
    });
    error = value.cause;
  }
  return result;
}

function requestShape(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") return { request_body_bytes: null, input_payload_bytes: null, output_token_cap: null };
  const common = { request_body_bytes: Buffer.byteLength(body), request_body_sha256: createHash("sha256").update(body).digest("hex") };
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const cap = parsed.max_completion_tokens ?? parsed.max_tokens;
    // Byte counts are evidence about the actual wire payload, not an assumed tokenizer bound.
    const input = JSON.stringify({ messages: parsed.messages, tools: parsed.tools, functions: parsed.functions });
    return { ...common, wire_model: typeof parsed.model === "string" ? parsed.model : null, input_payload_bytes: Buffer.byteLength(input), output_token_cap: Number.isInteger(cap) && Number(cap) > 0 ? cap : null, ...reasoningControls(parsed) };
  } catch { return { ...common, input_payload_bytes: null, output_token_cap: null }; }
}

/** The supported per-request fetch option keeps instrumentation local to provider inference. */
export function instrumentProviderFetch(fetch: typeof globalThis.fetch, logPath: string, allowance?: { path: string; modelId: string; contextWindow: number }): typeof globalThis.fetch {
  let warned = false;
  return async (input, init) => {
    const localRequestId = randomUUID();
    const started = performance.now();
    const record = (event: string, details: Record<string, unknown> = {}) => {
      try {
        appendFileSync(logPath, `${JSON.stringify({ event, local_request_id: localRequestId, at: new Date().toISOString(), elapsed_ms: Math.round(performance.now() - started), ...details })}\n`, { encoding: "utf8", mode: 0o600 });
      } catch {
        if (!warned) console.warn("Provider request telemetry unavailable: could not append evidence.");
        warned = true;
      }
    };
    const shape = requestShape(init?.body);
    if (allowance) {
      try {
        if (shape.wire_model !== allowance.modelId) throw new Error("Development allowance wire model mismatch; provider HTTP refused");
        await reserveProviderRequest(allowance.path, { id: localRequestId, stageEvidence: logPath, modelId: allowance.modelId, contextWindow: allowance.contextWindow, outputTokenCap: Number(shape.output_token_cap) });
      } catch (error) {
        record("allowance_refused", { phase: "before_http_dispatch", errors: errorKinds(error) });
        console.warn("Development allowance refused provider HTTP; inspect the shared allowance ledger.");
        throw error;
      }
    }
    record("request_started", shape);
    const unknown = async () => {
      if (!allowance) return;
      try { await markProviderRequestUnknown(allowance.path, localRequestId); }
      catch { record("allowance_update_failed"); }
    };
    const usage = allowance ? createProviderUsageObserver(async (confirmed) => {
      await settleProviderRequest(allowance.path, localRequestId, confirmed);
      record("allowance_usage_confirmed", { input_tokens_including_cache: confirmed.inputTokens, output_tokens: confirmed.outputTokens });
    }) : undefined;
    let response: Response;
    try { response = await fetch(input, init); }
    catch (error) {
      record("request_failed", { phase: "before_response_headers", errors: errorKinds(error) });
      await unknown();
      throw error;
    }
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
    record("response_headers", {
      status: response.status,
      ...(requestId && /^[A-Za-z0-9_.:-]{1,128}$/u.test(requestId) ? { provider_request_id: requestId } : {}),
    });
    if (!response.body) {
      record("response_body_completed", { response_bytes: 0 });
      await unknown();
      return response;
    }
    const reader = response.body.getReader();
    let bytes = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            try { if (usage && !await usage.complete()) await unknown(); }
            catch { record("allowance_update_failed"); }
            record("response_body_completed", { response_bytes: bytes });
            controller.close();
          } else {
            bytes += chunk.value.byteLength;
            try { await usage?.feed(chunk.value); }
            catch { record("allowance_update_failed"); }
            controller.enqueue(chunk.value);
          }
        } catch (error) {
          record("response_body_failed", { phase: "after_response_headers", response_bytes: bytes, errors: errorKinds(error) });
          await unknown();
          controller.error(error);
        }
      },
      async cancel(reason) {
        record("response_body_cancelled", { phase: "after_response_headers", response_bytes: bytes });
        await unknown();
        await reader.cancel(reason);
      },
    });
    const observed = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    // Preserve response metadata used by HTTP adapters while consuming the original stream once.
    for (const property of ["url", "redirected", "type"] as const) Object.defineProperty(observed, property, { value: response[property] });
    return observed;
  };
}

function instrumentProvider(provider: Provider, logPath: string, allowancePath: string | undefined): Provider {
  return new Proxy(provider, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (property === "stream" || property === "streamSimple") {
        return (model: { id: string; contextWindow: number }, context: unknown, options: { fetch?: typeof globalThis.fetch } = {}) =>
          Reflect.apply(value as (...args: unknown[]) => unknown, target, [model, context, {
            ...options, fetch: instrumentProviderFetch(options.fetch ?? globalThis.fetch, logPath, allowancePath ? { path: allowancePath, modelId: model.id, contextWindow: model.contextWindow } : undefined),
          }]);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Preserve the official provider catalog/auth/stream implementation and wrap only its supported transport seam. */
export function withProviderRequestTelemetry(pi: ExtensionAPI, logPath: string | undefined, allowancePath?: string): ExtensionAPI {
  if (!logPath) {
    if (allowancePath) throw new Error("Development allowance requires a stage telemetry path");
    return pi;
  }
  return new Proxy(pi, {
    get(target, property, receiver) {
      if (property !== "registerProvider") return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        const provider = args[0];
        if (provider && typeof provider === "object" && "id" in provider && provider.id === "berget") {
          args[0] = instrumentProvider(provider as Provider, logPath, allowancePath);
        }
        return Reflect.apply(target.registerProvider, target, args);
      };
    },
  });
}
