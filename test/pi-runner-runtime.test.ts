import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runPi } from "../src/pi-runner.js";

it.each([false, true])("signals once at the response cap, retains the drained batch and completes native shutdown (failed tool: %s)", async (failedTool) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-cap-shutdown-"));
  const app = path.join(directory, "app");
  const state = path.join(directory, "state");
  await mkdir(app);
  await mkdir(state);
  const shutdownLog = path.join(directory, "shutdown.jsonl");
  const extension = path.join(directory, "observe-shutdown.ts");
  // Public lifecycle hook and a signal observer only; no SDK implementation is
  // replaced. The delay exposes premature process exit during real disposal.
  await writeFile(extension, `import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
export default function observe(pi) {
  const record = (event) => appendFileSync(process.env.FIXTURE_SHUTDOWN_LOG, JSON.stringify({event}) + "\\n");
  process.on("SIGTERM", () => record("sigterm"));
  pi.on("session_shutdown", async () => {
    record("shutdown_started");
    await delay(200);
    record("shutdown_completed");
  });
}`);
  let requests = 0;
  const server = http.createServer(async (request, response) => {
    for await (const _ of request) { /* Drain the local fixture body. */ }
    requests += 1;
    const calls = ["app.ts", "domain.ts", "styles.css"].map((file, index) => ({
      index, id: `write-${index}`, type: "function",
      function: { name: "write", arguments: JSON.stringify({ path: file, content: `completed ${file}` }) },
    }));
    calls.push({ index: 3, id: "correction", type: "function", function: { name: "edit", arguments: JSON.stringify({ path: "app.ts", oldText: "completed app.ts", newText: "final batch correction" }) } });
    if (failedTool) calls.push({ index: 4, id: "failed-edit", type: "function", function: { name: "edit", arguments: JSON.stringify({ path: "app.ts", oldText: "missing", newText: "must fail" }) } });
    const chunk = (choices: unknown[], usage?: object) => ({ id: `response-${requests}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices, ...(usage ? { usage } : {}) });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify(chunk([{ index: 0, delta: requests === 1 ? { role: "assistant", tool_calls: calls } : { role: "assistant", content: "Unexpected second request" }, finish_reason: null }]))}\n\n`);
    response.write(`data: ${JSON.stringify(chunk([{ index: 0, delta: {}, finish_reason: requests === 1 ? "tool_calls" : "stop" }], { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }))}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected local HTTP address");
    await writeFile(path.join(state, "models.json"), JSON.stringify({ providers: { fixture: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-fixture",
      models: [{ id: "fixture", reasoning: false, contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } } }));
    const eventsFile = path.join(directory, "events.jsonl");
    const stderrFile = path.join(directory, "stderr.log");
    const result = await runPi([
      "--mode", "json", "--print", "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
      "--tools", "write,edit", "--provider", "fixture", "--model", "fixture", "--thinking", "off", "--extension", extension,
      "--system-prompt", "Write local fixture files.", "Write the fixture.",
    ], app, eventsFile, stderrFile, 15_000, {
      PATH: process.env.PATH, HOME: directory, PI_CODING_AGENT_DIR: state, PI_OFFLINE: "1", FIXTURE_SHUTDOWN_LOG: shutdownLog,
    }, 1);
    const events = (await readFile(eventsFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const shutdown = (await readFile(shutdownLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line).event);
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, modelCalls: 1, callLimitReached: true, successfulToolCalls: 4 });
    // A stdout stop is not an HTTP admission guard: the next dispatch may race
    // the signal. Preserve that limitation instead of claiming a strict cap.
    console.info("[pi-cap-fixture]", JSON.stringify({ failedTool, httpDispatches: requests, completedResponses: result.modelCalls, shutdown }));
    expect(requests).toBeGreaterThanOrEqual(1);
    expect(events.filter((event) => event.type === "tool_execution_end")).toHaveLength(failedTool ? 5 : 4);
    expect(events.filter((event) => event.type === "tool_execution_end" && event.isError)).toHaveLength(failedTool ? 1 : 0);
    expect(await readFile(path.join(app, "app.ts"), "utf8")).toBe("final batch correction");
    expect(await readFile(path.join(app, "domain.ts"), "utf8")).toBe("completed domain.ts");
    expect(await readFile(path.join(app, "styles.css"), "utf8")).toBe("completed styles.css");
    expect(shutdown.filter((event) => event === "sigterm")).toHaveLength(1);
    expect(shutdown).toContain("shutdown_completed");
    expect(await readFile(stderrFile, "utf8")).toBe("");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
