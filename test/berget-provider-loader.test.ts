import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { resolveBergetExtension } from "../src/provider.js";

const execute = promisify(execFile);

it("loads the retry wrapper through native Pi before selecting the requested model and overrides", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "berget-loader-"));
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method !== "GET" || request.url !== "/v1/models/chat") {
      response.writeHead(500).end("Unexpected endpoint; no inference is allowed in this test.");
    } else if (requests.length === 1) {
      response.writeHead(503).end("Temporary catalog outage");
    } else {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ models: [
        { id: "zai-org/GLM-5.2", contextWindow: 123456, inputPricePerToken: 0.0000037, outputPricePerToken: 0.0000081 },
      ] }));
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local catalog port");
    const apiUrl = `http://127.0.0.1:${address.port}`;
    await writeFile(path.join(directory, "models.json"), JSON.stringify({ providers: { berget: {
      modelOverrides: { "zai-org/GLM-5.2": { maxTokens: 12000 } },
    } } }));
    const cli = fileURLToPath(new URL("cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
    const result = await execute(process.execPath, [cli, "--no-extensions", "--extension", resolveBergetExtension(), "--list-models", "GLM-5.2"], {
      cwd: directory,
      env: { ...process.env, PI_CODING_AGENT_DIR: directory, BERGET_API_URL: apiUrl, BERGET_INFERENCE_URL: `${apiUrl}/v1`, BERGET_API_KEY: "offline-test-key" },
      timeout: 20000,
    });
    expect(result.stdout).toContain("zai-org/GLM-5.2");
    expect(result.stdout).toContain("12K");
    expect(result.stderr).toContain("retrying startup (2/3)");
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests.every((request) => request === "GET /v1/models/chat")).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 25000);
