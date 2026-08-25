import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRuntimeEnvironment,
  getSystemEnvironment,
  validateQualificationEnvironment,
} from "./config.js";

const require = createRequire(import.meta.url);

export const PI_VERSION = "0.84.1";
export const BERGET_PROVIDER_VERSION = "0.3.2";
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_KILL_GRACE_MS = 1_000;
export const QUALIFICATION_TOOL_NAMES = Object.freeze([
  "reveal_qualification_nonce",
  "persist_qualification_nonce",
]);

export function resolvePiCli() {
  const packageEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return join(dirname(packageEntry), "cli.js");
}

export function resolveBergetExtension() {
  return join(dirname(require.resolve("@bergetai/pi-provider/package.json")), "index.ts");
}

export function resolveRuntimeGuardExtension() {
  return fileURLToPath(new URL("./runtime-guard-extension.js", import.meta.url));
}

export function piModelArgument(configuration) {
  if (configuration.provider === "berget" && !configuration.model.startsWith("berget/")) {
    return `berget/${configuration.model}`;
  }
  return configuration.model;
}

/**
 * Build an argument array for Pi. The API key is intentionally absent: Pi's
 * Berget extension reads BERGET_API_KEY from the child environment.
 */
export function buildPiInvocation(
  configuration,
  {
    cwd,
    sessionDir,
    prompt,
    piCli = resolvePiCli(),
    bergetExtension,
    runtimeGuardExtension = resolveRuntimeGuardExtension(),
    qualificationExtension,
    qualification = false,
  } = {},
) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error("Pi prompt must be a non-empty string");
  }
  if (typeof sessionDir !== "string" || sessionDir.trim() === "") {
    throw new Error("Pi session directory is required");
  }
  if (qualification && (typeof qualificationExtension !== "string" || qualificationExtension.trim() === "")) {
    throw new Error("Pi qualification extension is required in qualification mode");
  }

  const resolvedBergetExtension = configuration.provider === "berget"
    ? (bergetExtension ?? resolveBergetExtension())
    : null;
  const args = [
    piCli,
    "--mode",
    "json",
    "--print",
    "--provider",
    configuration.provider,
    "--model",
    piModelArgument(configuration),
    "--thinking",
    configuration.thinking,
    "--session-dir",
    sessionDir,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-approve",
  ];

  if (configuration.provider === "berget") {
    args.push("--extension", resolvedBergetExtension);
  }
  if (qualification) {
    args.push(
      "--extension",
      resolve(qualificationExtension),
      "--no-builtin-tools",
      "--tools",
      QUALIFICATION_TOOL_NAMES.join(","),
    );
  } else {
    args.push("--extension", resolve(runtimeGuardExtension));
  }
  args.push(prompt);

  return {
    command: process.execPath,
    args,
    cwd: cwd ? resolve(cwd) : process.cwd(),
    shell: false,
    detached: true,
    provider: configuration.provider,
    requestedModel: configuration.model,
    effectiveModelArgument: piModelArgument(configuration),
    thinking: configuration.thinking,
    sessionDir: resolve(sessionDir),
    extension: resolvedBergetExtension,
    runtimeGuardExtension: qualification ? null : resolve(runtimeGuardExtension),
    qualification,
    qualificationExtension: qualification ? resolve(qualificationExtension) : null,
    tools: qualification ? [...QUALIFICATION_TOOL_NAMES] : null,
  };
}

function appendLimited(current, chunk, limit) {
  const next = `${current}${chunk}`;
  if (Buffer.byteLength(next, "utf8") <= limit) {
    return { value: next, truncated: false };
  }
  const bytes = Buffer.from(next, "utf8").subarray(0, limit);
  return { value: bytes.toString("utf8"), truncated: true };
}

function killProcessGroup(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

export function terminateProcessTree(child, signal = "SIGTERM") {
  return killProcessGroup(child?.pid, signal);
}

/**
 * Run a prepared Pi invocation with bounded output and process-tree cleanup.
 * This is intentionally generic enough for synthetic Gate A subprocess tests.
 */
export function runPiInvocation(
  invocation,
  {
    environment = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    outputLimitBytes = DEFAULT_OUTPUT_LIMIT_BYTES,
    spawnImplementation = spawn,
  } = {},
) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    let child;
    try {
      const sentinelPath = environment.AGENTCOFOUNDER_TEST_PI_SPAWN_SENTINEL;
      if (typeof sentinelPath === "string" && sentinelPath !== "") {
        mkdirSync(dirname(resolve(sentinelPath)), { recursive: true });
        writeFileSync(resolve(sentinelPath), "pi-spawn-observed\n", { encoding: "utf8", mode: 0o600 });
      }
      child = spawnImplementation(invocation.command, invocation.args, {
        cwd: invocation.cwd,
        detached: true,
        env: { ...environment },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let termSent = false;
    let killSent = false;
    let settled = false;
    let killTimer;
    let pendingClose;

    const finish = (code, signal) => {
      if (settled) return;
      if (timedOut && killTimer !== undefined) {
        pendingClose = { code, signal };
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      resolvePromise({
        code,
        signal,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        timedOut,
        termSent,
        killSent,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      });
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      const result = appendLimited(stdout, chunk, outputLimitBytes);
      stdout = result.value;
      stdoutTruncated ||= result.truncated;
    });
    child.stderr?.on("data", (chunk) => {
      const result = appendLimited(stderr, chunk, outputLimitBytes);
      stderr = result.value;
      stderrTruncated ||= result.truncated;
    });
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutTimer);
        clearTimeout(killTimer);
        reject(error);
      }
    });
    child.once("close", finish);

    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      termSent = terminateProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => {
        killSent = terminateProcessTree(child, "SIGKILL");
        const closed = pendingClose;
        killTimer = undefined;
        if (closed) finish(closed.code, closed.signal);
      }, killGraceMs);
    }, timeoutMs);
    timeoutTimer.unref?.();
  });
}

export async function ensureSessionDirectory(sessionDir) {
  await mkdir(resolve(sessionDir), { recursive: true });
  return resolve(sessionDir);
}

export async function preparePiRuntimeState({
  agentDir,
  sessionDir,
  homeDir,
  xdgConfigDir,
  xdgCacheDir,
  xdgDataDir,
  xdgStateDir,
}) {
  const resolvedAgentDir = resolve(agentDir);
  const resolvedSessionDir = resolve(sessionDir);
  for (const path of [
    resolvedAgentDir,
    resolvedSessionDir,
    resolve(homeDir),
    resolve(xdgConfigDir),
    resolve(xdgCacheDir),
    resolve(xdgDataDir),
    resolve(xdgStateDir),
  ]) {
    await mkdir(path, { recursive: true });
  }
  await writeFile(
    join(resolvedAgentDir, "settings.json"),
    `${JSON.stringify({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      enableInstallTelemetry: false,
      enableAnalytics: false,
      defaultProjectTrust: "never",
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return {
    agentDir: resolvedAgentDir,
    sessionDir: resolvedSessionDir,
    homeDir: resolve(homeDir),
    xdgConfigDir: resolve(xdgConfigDir),
    xdgCacheDir: resolve(xdgCacheDir),
    xdgDataDir: resolve(xdgDataDir),
    xdgStateDir: resolve(xdgStateDir),
  };
}

export function buildPiEnvironment(
  environment,
  configuration,
  {
    agentDir,
    sessionDir,
    homeDir,
    xdgConfigDir,
    xdgCacheDir,
    xdgDataDir,
    xdgStateDir,
  },
  { qualification = false } = {},
) {
  const result = {
    ...getSystemEnvironment(environment),
    ...getRuntimeEnvironment(configuration, environment),
    HOME: resolve(homeDir),
    XDG_CONFIG_HOME: resolve(xdgConfigDir),
    XDG_CACHE_HOME: resolve(xdgCacheDir),
    XDG_DATA_HOME: resolve(xdgDataDir),
    XDG_STATE_HOME: resolve(xdgStateDir),
    PI_CODING_AGENT_DIR: resolve(agentDir),
    PI_CODING_AGENT_SESSION_DIR: resolve(sessionDir),
    PI_TELEMETRY: "0",
    PI_SKIP_VERSION_CHECK: "1",
  };
  if (typeof environment.AGENTCOFOUNDER_TEST_PI_SPAWN_SENTINEL === "string") {
    result.AGENTCOFOUNDER_TEST_PI_SPAWN_SENTINEL = environment.AGENTCOFOUNDER_TEST_PI_SPAWN_SENTINEL;
  }
  if (qualification) {
    Object.assign(result, validateQualificationEnvironment(environment));
  }
  return result;
}

export function invocationMetadata(invocation) {
  return {
    command: invocation.command,
    arguments: invocation.args.map((argument) =>
      argument === invocation.args.at(-1) ? "<prompt>" : argument,
    ),
    cwd: invocation.cwd,
    shell: invocation.shell,
    detached: invocation.detached,
    provider: invocation.provider,
    requestedModel: invocation.requestedModel,
    effectiveModelArgument: invocation.effectiveModelArgument,
    thinking: invocation.thinking,
    sessionDir: invocation.sessionDir,
    extension: invocation.extension,
    runtimeGuardExtension: invocation.runtimeGuardExtension,
    qualification: invocation.qualification,
    qualificationExtension: invocation.qualificationExtension,
    tools: invocation.tools,
  };
}
