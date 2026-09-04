import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArguments } from "../src/run-challenge.js";
import { productReport, rootStartCommand } from "../src/result.js";
import { portHasListener, verifyGeneratedApp } from "../src/verify-app.js";
import { validProductSpec } from "./fixtures/product-spec.js";

const temporaryDirectories: string[] = [];

async function reservePort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP port");
  return {
    port: address.port,
    release: async () => {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function concurrentApp(root: string, name: string, peer: string) {
  const appDirectory = path.join(root, name, "app");
  const artifactDirectory = path.join(root, name, "artifacts");
  const template = path.resolve("app-template");
  await cp(template, appDirectory, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("node_modules") && !source.endsWith(`${path.sep}dist`),
  });
  await symlink(path.join(template, "node_modules"), path.join(appDirectory, "node_modules"), "dir");
  await mkdir(artifactDirectory);
  await writeFile(path.join(appDirectory, "src", "generated.test.tsx"), `import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";
it("[journey_${name}] renders its own application", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
});
`);
  // Neither startup probe may complete before both real Vite servers are listening.
  // This makes the overlap deterministic instead of relying on similar build durations.
  await writeFile(path.join(appDirectory, "vite.config.ts"), `import { existsSync, writeFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react(), {
    name: "concurrent-verification-proof",
    configureServer(server) {
      server.httpServer?.once("listening", () => writeFileSync(${JSON.stringify(path.join(root, `${name}.ready`))}, "ready"));
      server.middlewares.use((request, response, next) => {
        if (request.url !== "/") return next();
        const timer = setInterval(() => {
          if (!existsSync(${JSON.stringify(path.join(root, `${peer}.ready`))})) return;
          clearInterval(timer);
          writeFileSync(${JSON.stringify(path.join(root, `${name}.overlap`))}, "Both applications were listening before this probe completed.");
          next();
        }, 10);
        response.once("close", () => clearInterval(timer));
      });
    },
  }],
  server: { host: "0.0.0.0", port: 3000, strictPort: true },
});
`);
  return { appDirectory, artifactDirectory };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("development verification ports", () => {
  it("defaults to the submission port and validates explicit port boundaries", () => {
    expect(parseArguments([]).verificationPort).toBe(3000);
    expect(parseArguments(["--verification-port", "1"]).verificationPort).toBe(1);
    expect(parseArguments(["--verification-port", "65535"]).verificationPort).toBe(65535);
    for (const value of ["0", "-1", "65536", "4.5", "invalid", ""]) {
      expect(() => parseArguments(["--verification-port", value])).toThrow();
    }
    expect(() => parseArguments(["--verification-port"])).toThrow();
  });

  it("verifies two isolated apps concurrently without changing their delivered port contract", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-concurrent-verification-"));
    temporaryDirectories.push(root);
    const [first, second] = await Promise.all([reservePort(), reservePort()]);
    try {
      expect(first.port).not.toBe(second.port);
      expect([first.port, second.port]).not.toContain(3000);
      const apps = await Promise.all([concurrentApp(root, "alpha", "beta"), concurrentApp(root, "beta", "alpha")]);
      await Promise.all([first.release(), second.release()]);
      const outcomes = await Promise.all(apps.map((app, index) => verifyGeneratedApp(app.appDirectory, app.artifactDirectory, {
        port: index === 0 ? first.port : second.port,
        commandTimeoutMs: 30_000,
        serverTimeoutMs: 15_000,
        journeys: [{ id: index === 0 ? "journey_alpha" : "journey_beta" }],
      })));
      for (const [index, name] of ["alpha", "beta"].entries()) {
        const outcome = outcomes[index]!;
        const app = apps[index]!;
        const port = index === 0 ? first.port : second.port;
        expect(outcome.passed).toBe(true);
        expect(outcome.checks[2]).toMatchObject({ command: `npm run dev -- --port ${port}`, result: "passed" });
        expect(outcome.journeys?.[0]).toMatchObject({ id: `journey_${name}`, result: "passed" });
        expect(await readFile(path.join(root, `${name}.overlap`), "utf8")).toContain("Both applications were listening");
        expect(await portHasListener(port)).toBe(false);
        expect(productReport(validProductSpec(), outcome)).toMatchObject({ app_url: "http://localhost:3000", start_command: "npm run dev" });
        expect(rootStartCommand(root, app.appDirectory)).toBe(`npm --prefix '${name}/app' run dev`);
        const manifest = JSON.parse(await readFile(path.join(app.appDirectory, "package.json"), "utf8"));
        expect(manifest.scripts.dev).toContain("--port 3000 --strictPort");
      }
    } finally {
      await Promise.all([first.release(), second.release()]);
    }
  }, 60_000);
});
