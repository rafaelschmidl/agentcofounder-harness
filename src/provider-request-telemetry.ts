import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ERROR_CODES = new Set([
  "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ABORT_ERR",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);
const ERROR_NAMES = new Set([
  "Error", "TypeError", "AbortError", "TimeoutError", "ConnectTimeoutError", "HeadersTimeoutError", "BodyTimeoutError", "SocketError",
]);

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
    return { ...common, input_payload_bytes: Buffer.byteLength(input), output_token_cap: Number.isInteger(cap) && Number(cap) > 0 ? cap : null };
  } catch { return { ...common, input_payload_bytes: null, output_token_cap: null }; }
}

/** The supported per-request fetch option keeps instrumentation local to provider inference. */
export function instrumentProviderFetch(fetch: typeof globalThis.fetch, logPath: string): typeof globalThis.fetch {
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
    record("request_started", requestShape(init?.body));
    let response: Response;
    try { response = await fetch(input, init); }
    catch (error) {
      record("request_failed", { phase: "before_response_headers", errors: errorKinds(error) });
      throw error;
    }
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
    record("response_headers", {
      status: response.status,
      ...(requestId && /^[A-Za-z0-9_.:-]{1,128}$/u.test(requestId) ? { provider_request_id: requestId } : {}),
    });
    if (!response.body) {
      record("response_body_completed", { response_bytes: 0 });
      return response;
    }
    const reader = response.body.getReader();
    let bytes = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            record("response_body_completed", { response_bytes: bytes });
            controller.close();
          } else {
            bytes += chunk.value.byteLength;
            controller.enqueue(chunk.value);
          }
        } catch (error) {
          record("response_body_failed", { phase: "after_response_headers", response_bytes: bytes, errors: errorKinds(error) });
          controller.error(error);
        }
      },
      async cancel(reason) {
        record("response_body_cancelled", { phase: "after_response_headers", response_bytes: bytes });
        await reader.cancel(reason);
      },
    });
    const observed = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    // Preserve response metadata used by HTTP adapters while consuming the original stream once.
    for (const property of ["url", "redirected", "type"] as const) Object.defineProperty(observed, property, { value: response[property] });
    return observed;
  };
}

function instrumentProvider(provider: Provider, logPath: string): Provider {
  return new Proxy(provider, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (property === "stream" || property === "streamSimple") {
        return (model: unknown, context: unknown, options: { fetch?: typeof globalThis.fetch } = {}) =>
          Reflect.apply(value as (...args: unknown[]) => unknown, target, [model, context, {
            ...options, fetch: instrumentProviderFetch(options.fetch ?? globalThis.fetch, logPath),
          }]);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Preserve the official provider catalog/auth/stream implementation and wrap only its supported transport seam. */
export function withProviderRequestTelemetry(pi: ExtensionAPI, logPath: string | undefined): ExtensionAPI {
  if (!logPath) return pi;
  return new Proxy(pi, {
    get(target, property, receiver) {
      if (property !== "registerProvider") return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        const provider = args[0];
        if (provider && typeof provider === "object" && "id" in provider && provider.id === "berget") {
          args[0] = instrumentProvider(provider as Provider, logPath);
        }
        return Reflect.apply(target.registerProvider, target, args);
      };
    },
  });
}
