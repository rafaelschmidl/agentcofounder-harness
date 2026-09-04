const PROVIDER_ERROR_LABELS = new Set([
  "server_error", "internal_error", "internal_server_error", "api_error", "upstream_error", "upstream_timeout",
  "timeout_error", "request_timeout", "overloaded_error", "service_unavailable", "model_error",
  "invalid_request_error", "context_length_exceeded", "rate_limit_error", "rate_limit_exceeded",
  "insufficient_quota", "authentication_error", "permission_error", "not_found_error",
]);
type SafeProviderError = { error_envelope_present: true; named_error_event: boolean; code: string; type: string };

/** Inspect only SSE metering and allowlisted error metadata; never retain response content or error messages. */
export function createProviderUsageObserver(
  confirm: ((usage: { inputTokens: number; outputTokens: number }) => Promise<void>) | undefined,
  onError?: (error: SafeProviderError) => void,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let dataBytes = 0;
  let namedErrorEvent = false;
  let valid = true;
  let finished = false;
  let settled = false;
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  const settle = async () => {
    if (confirm && !settled && valid && finished && usage) {
      await confirm(usage);
      settled = true;
    }
  };
  const event = async () => {
    const payload = data.join("\n");
    const isNamedError = namedErrorEvent;
    data = [];
    dataBytes = 0;
    namedErrorEvent = false;
    if (!payload) return;
    // Settlement waits for this HTTP body's EOF, even after a terminal SSE marker.
    if (payload.trim() === "[DONE]") return;
    try {
      const chunk = JSON.parse(payload) as { error?: unknown; choices?: { finish_reason?: unknown }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } };
      if (chunk.error || isNamedError) {
        valid = false;
        const error = chunk.error && typeof chunk.error === "object" ? chunk.error as Record<string, unknown> : {};
        const label = (value: unknown) => typeof value === "string" && PROVIDER_ERROR_LABELS.has(value) ? value : "unrecognized";
        onError?.({ error_envelope_present: true, named_error_event: isNamedError, code: label(error.code), type: label(error.type) });
      }
      if (chunk.choices?.some((choice) => ["stop", "length", "tool_calls", "function_call"].includes(String(choice.finish_reason)))) finished = true;
      if (chunk.usage) {
        const input = chunk.usage.prompt_tokens;
        const output = chunk.usage.completion_tokens;
        const total = chunk.usage.total_tokens;
        if (typeof input === "number" && Number.isInteger(input) && input > 0
          && typeof output === "number" && Number.isInteger(output) && output >= 0
          && total === input + output) usage = { inputTokens: input, outputTokens: output };
        else valid = false;
      }
    } catch {
      valid = false;
      if (isNamedError) onError?.({ error_envelope_present: true, named_error_event: true, code: "unrecognized", type: "unrecognized" });
    }
  };
  const consume = async () => {
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/u, "");
      buffer = buffer.slice(newline + 1);
      if (!line) await event();
      else if (line.startsWith("event:")) namedErrorEvent = line.slice(6).trim() === "error";
      else if (line.startsWith("data:")) {
        const value = line.slice(5).replace(/^ /u, "");
        dataBytes += value.length;
        if (dataBytes > 1_048_576) { valid = false; data = []; }
        else data.push(value);
      }
    }
    if (buffer.length > 1_048_576) { valid = false; buffer = ""; }
  };
  return {
    async feed(chunk: Uint8Array) { buffer += decoder.decode(chunk, { stream: true }); await consume(); },
    async complete() {
      buffer += decoder.decode();
      if (buffer) buffer += "\n\n";
      await consume();
      await event();
      await settle();
      return settled;
    },
    settled: () => settled,
  };
}
