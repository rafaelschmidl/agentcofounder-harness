import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { FileOwnership } from "../src/build-plan/types.js";

const root = fileURLToPath(new URL("../", import.meta.url));
type Write = { path: string; content: string };
type ToolCall = Write | { name: "edit" | "finish_repair" | "read"; arguments: Record<string, string> };
type Response = ToolCall[] | "stop";

/** Real installed Pi, its built-in write implementation, and a local HTTP provider. */
async function runFixture(options: {
  files: string[];
  repair?: boolean;
  read?: boolean;
  prepare?: (app: string) => Promise<void>;
  response: (request: number, app: string) => Promise<Response> | Response;
}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "owned-paths-runtime-"));
  const app = path.join(directory, "app");
  const state = path.join(directory, "pi-state");
  await mkdir(app);
  await mkdir(state);
  const ownership: FileOwnership[] = [
    ...options.files.map((file) => ({ path: file, owner: "AGENT" as const, owner_id: "product" })),
    { path: "system.ts", owner: "BLOCK", owner_id: "foundation" },
  ];
  await writeFile(path.join(app, "system.ts"), "immutable foundation");
  const ownershipFile = path.join(directory, "file_ownership.json");
  await writeFile(ownershipFile, JSON.stringify(ownership));
  await options.prepare?.(app);
  let requests = 0;
  const requestBodies: { messages: { role: string; content: unknown }[] }[] = [];
  const serverErrors: unknown[] = [];
  const server = http.createServer(async (request, response) => {
    try {
      let requestBody = "";
      for await (const chunk of request) requestBody += String(chunk);
      requestBodies.push(JSON.parse(requestBody));
      requests += 1;
      const planned = requests <= 5 ? await options.response(requests, app) : "stop";
      const delta = planned === "stop" ? { role: "assistant", content: "Done." } : {
        role: "assistant",
        tool_calls: planned.map((call, index) => ({
          index, id: `call-${requests}-${index}`, type: "function",
          function: "name" in call ? { name: call.name, arguments: JSON.stringify(call.arguments) }
            : { name: "write", arguments: JSON.stringify(call) },
        })),
      };
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (choices: unknown[], usage?: unknown) => ({
        id: `response-${requests}`, object: "chat.completion.chunk", created: 1,
        model: "fixture", choices, ...(usage ? { usage } : {}),
      });
      response.write(`data: ${JSON.stringify(chunk([{ index: 0, delta, finish_reason: null }]))}\n\n`);
      response.write(`data: ${JSON.stringify(chunk([{ index: 0, delta: {}, finish_reason: planned === "stop" ? "stop" : "tool_calls" }], { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }))}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch (error) {
      serverErrors.push(error);
      response.writeHead(500).end("fixture error");
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected local HTTP address");
    await writeFile(path.join(state, "models.json"), JSON.stringify({ providers: {
      fixture: {
        baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-fixture",
        models: [{ id: "fixture", reasoning: false, contextWindow: 32768, maxTokens: 1024,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      },
    } }));
    const child = spawn(path.join(root, "node_modules/.bin/pi"), [
      "--mode", "json", "--print", "--offline", "--no-extensions", "--no-skills",
      "--no-prompt-templates", "--no-themes", "--no-context-files", "--tools", (options.read ? "read," : "") + (options.repair ? "write,edit,finish_repair" : "write"),
      "--provider", "fixture", "--model", "fixture", "--thinking", "off",
      "--extension", path.join(root, "solution/extensions/owned-paths.ts"),
      ...(options.repair ? ["--extension", path.join(root, "solution/extensions/repair-completion.ts")] : []),
      "--system-prompt", "Write the requested fixture files.", "Build the fixture.",
    ], {
      cwd: app, stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH, HOME: directory, PI_CODING_AGENT_DIR: state, PI_OFFLINE: "1",
        SYSTEM_V0_OWNERSHIP_FILE: ownershipFile,
        ...(options.repair ? { SYSTEM_V0_PERMITTED_PATHS: JSON.stringify(options.files) } : {}),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => child.kill("SIGTERM"), 15_000);
    let code: number | null;
    try {
      code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
    } finally { clearTimeout(timer); }
    expect(serverErrors).toEqual([]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const events = stdout.trim().split("\n").map((line) => JSON.parse(line));
    const assistant = events.filter((event) => event.type === "message_end" && event.message.role === "assistant");
    expect(assistant).toHaveLength(requests);
    expect(assistant.every((event) => ["toolUse", "stop"].includes(event.message.stopReason))).toBe(true);
    expect(assistant.every((event) => event.message.usage.totalTokens === 11)).toBe(true);
    expect(events.at(-1).type).toBe("agent_settled");
    const content = Object.fromEntries(await Promise.all(ownership.map(async (entry) => [entry.path, await readFile(path.join(app, entry.path), "utf8")])));
    return { requests, events, content, requestBodies };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

it.each([3, 4])("finishes a %i-file builder after the entire final batch, with one HTTP request and no synthetic abort", async (count) => {
  const files = Array.from({ length: count }, (_, index) => `product-${index}.ts`);
  const result = await runFixture({
    files,
    response: () => [...files.map((file) => ({ path: file, content: "initial" })), { path: files[0]!, content: "final correction" }],
  });
  expect(result.requests).toBe(1);
  expect(result.content[files[0]!]).toBe("final correction");
  expect(result.events.filter((event) => event.type === "tool_execution_end")).toHaveLength(count + 1);
  expect(result.content["system.ts"]).toBe("immutable foundation");
}, 20_000);

it("does not count duplicate writes, a failed write, or a blocked foundation write toward completion", async () => {
  const result = await runFixture({
    files: ["app.ts", "styles.css"],
    prepare: (app) => mkdir(path.join(app, "styles.css")),
    response: async (request, app) => {
      if (request === 1) return [
        { path: "app.ts", content: "first" }, { path: "app.ts", content: "second" },
        { path: "styles.css", content: "fails because the path is a directory" },
        { path: "system.ts", content: "must be blocked" },
      ];
      await rm(path.join(app, "styles.css"), { recursive: true, force: true });
      return [{ path: "styles.css", content: "successful stylesheet" }];
    },
  });
  expect(result.requests).toBe(2);
  const toolFeedback = result.requestBodies[1]!.messages.filter((message) => message.role === "tool");
  expect(JSON.stringify(toolFeedback)).toContain("required files still missing: styles.css");
  expect(JSON.stringify(toolFeedback)).not.toContain("required files still missing: app.ts");
  expect(result.events.filter((event) => event.type === "tool_execution_end" && event.isError)).toHaveLength(2);
  expect(result.content).toMatchObject({ "app.ts": "second", "styles.css": "successful stylesheet", "system.ts": "immutable foundation" });
}, 20_000);

it("returns a substantive repair batch to verification after all files and same-batch corrections drain", async () => {
  const files = ["app.ts", "domain.ts", "styles.css"];
  const result = await runFixture({
    files, repair: true,
    response: () => [
      ...files.map((file) => ({ path: file, content: "repair first pass" })),
      { name: "edit", arguments: { path: "app.ts", oldText: "repair first pass", newText: "same-batch correction" } },
    ],
  });
  expect(result.requests).toBe(1);
  expect(result.content).toMatchObject({ "app.ts": "same-batch correction", "domain.ts": "repair first pass", "styles.css": "repair first pass" });
  expect(result.events.filter((event) => event.type === "tool_execution_end")).toHaveLength(4);
  expect(result.events.some((event) => event.toolName === "finish_repair")).toBe(false);
}, 20_000);

it("does not hand back for noop writes, refused writes, failed edits, or reads without a substantive mutation", async () => {
  const result = await runFixture({
    files: ["app.ts"], repair: true, read: true,
    prepare: (app) => writeFile(path.join(app, "app.ts"), "original"),
    response: (request) => request === 1 ? [
      { path: "app.ts", content: "original" },
    ] : request === 2 ? [
      { path: "system.ts", content: "must stay blocked" },
      { name: "edit", arguments: { path: "app.ts", oldText: "missing", newText: "replacement" } },
      { name: "read", arguments: { path: "app.ts" } },
    ] : [{ name: "edit", arguments: { path: "app.ts", oldText: "original", newText: "actual correction" } }],
  });
  expect(result.requests).toBe(3);
  expect(result.content).toMatchObject({ "app.ts": "actual correction", "system.ts": "immutable foundation" });
  expect(result.events.filter((event) => event.type === "tool_execution_end" && event.isError)).toHaveLength(2);
  expect(JSON.stringify(result.requestBodies[2]!.messages)).toContain("missing");
}, 20_000);

it("preserves a mixed successful and failed repair batch, then accepts explicit handback", async () => {
  const result = await runFixture({
    files: ["app.ts", "styles.css"], repair: true,
    response: (request) => request === 1 ? [
      { path: "app.ts", content: "actual correction" },
      { name: "edit", arguments: { path: "app.ts", oldText: "missing", newText: "must fail" } },
      { path: "styles.css", content: "completed despite earlier failure" },
    ] : [{ name: "finish_repair", arguments: { summary: "Return mixed batch to verification with the failed edit preserved." } }],
  });
  // Pi requires every native result to request termination. A native failure
  // cannot carry our getter, so retain this honest fallback rather than marking
  // the failed edit successful merely to stop one response earlier.
  expect(result.requests).toBe(2);
  expect(result.content).toMatchObject({ "app.ts": "actual correction", "styles.css": "completed despite earlier failure" });
  expect(result.events.filter((event) => event.type === "tool_execution_end")).toHaveLength(4);
  expect(result.events.filter((event) => event.type === "tool_execution_end" && event.isError)).toHaveLength(1);
  expect(JSON.stringify(result.requestBodies[1]!.messages)).toContain("missing");
}, 20_000);

it("drains writes and edits around a mixed repair handoff without a second HTTP request", async () => {
  const result = await runFixture({
    files: ["app.ts"], repair: true,
    response: () => [
      { path: "app.ts", content: "first correction" },
      { name: "finish_repair", arguments: { summary: "Ready for verification after this batch." } },
      { name: "edit", arguments: { path: "app.ts", oldText: "first correction", newText: "final correction" } },
    ],
  });
  expect(result.requests).toBe(1);
  expect(result.content["app.ts"]).toBe("final correction");
  expect(result.events.filter((event) => event.type === "tool_execution_end")).toHaveLength(3);
}, 20_000);

it("retains an actual failed edit when a mixed repair batch also asks for handoff", async () => {
  const result = await runFixture({
    files: ["app.ts"], repair: true,
    prepare: (app) => writeFile(path.join(app, "app.ts"), "original"),
    response: (request) => request === 1 ? [
      { name: "edit", arguments: { path: "app.ts", oldText: "missing text", newText: "replacement" } },
      { name: "finish_repair", arguments: { summary: "Return the failed edit to verification." } },
    ] : "stop",
  });
  // Native failed results cannot carry this extension's termination flag. Keep
  // that limitation visible: the external harness remains the fallback here.
  expect(result.requests).toBe(2);
  expect(result.content["app.ts"]).toBe("original");
  expect(result.events.filter((event) => event.type === "tool_execution_end" && event.isError)).toHaveLength(1);
}, 20_000);
