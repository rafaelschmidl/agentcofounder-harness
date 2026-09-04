/** Inspect only SSE metering metadata; never retain text, reasoning, or tool content. */
export function createProviderUsageObserver(confirm: (usage: { inputTokens: number; outputTokens: number }) => Promise<void>) {
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let dataBytes = 0;
  let valid = true;
  let finished = false;
  let settled = false;
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  const settle = async () => {
    if (!settled && valid && finished && usage) {
      await confirm(usage);
      settled = true;
    }
  };
  const event = async () => {
    const payload = data.join("\n");
    data = [];
    dataBytes = 0;
    if (!payload) return;
    // Settlement waits for this HTTP body's EOF, even after a terminal SSE marker.
    if (payload.trim() === "[DONE]") return;
    try {
      const chunk = JSON.parse(payload) as { error?: unknown; choices?: { finish_reason?: unknown }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } };
      if (chunk.error) valid = false;
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
    } catch { valid = false; }
  };
  const consume = async () => {
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/u, "");
      buffer = buffer.slice(newline + 1);
      if (!line) await event();
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
