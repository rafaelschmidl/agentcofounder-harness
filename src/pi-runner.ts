import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signalProcessTree, terminateProcessTree, usesDetachedProcessGroup } from "./process-tree.js";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SOURCE_DIRECTORY, "..");

export interface CommandResult {
  exitCode: number;
  timedOut: boolean;
  modelCalls: number;
  callLimitReached: boolean;
  successfulToolCalls: number;
  toolLimitReached: boolean;
  completedFiles: string[];
  requiredFilesComplete: boolean;
  completionTool?: string;
}

export interface EventSummary {
  assistantCall: boolean;
  stopReason: string;
  toolCalls: number;
  toolExecutionEnded: boolean;
  toolExecutionSucceeded: boolean;
  toolExecutionStarted: boolean;
  toolCallId?: string;
  toolName?: string;
  toolPath?: string;
}

export function summarizeEventLine(line: string): EventSummary {
  const summary: EventSummary = {
    assistantCall: false,
    stopReason: "",
    toolCalls: 0,
    toolExecutionEnded: false,
    toolExecutionSucceeded: false,
    toolExecutionStarted: false,
  };
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (typeof event.toolCallId === "string") summary.toolCallId = event.toolCallId;
    if (typeof event.toolName === "string") summary.toolName = event.toolName;
    if (event.type === "tool_execution_start") {
      summary.toolExecutionStarted = true;
      const args = event.args as Record<string, unknown> | undefined;
      if (typeof args?.path === "string") summary.toolPath = args.path;
    }
    if (event.type === "tool_execution_end") {
      summary.toolExecutionEnded = true;
      summary.toolExecutionSucceeded = event.isError !== true;
      console.log(`[pi] completed tool: ${String(event.toolName ?? "unknown")}`);
    }
    if (event.type === "message_end") {
      const message = event.message as Record<string, unknown> | undefined;
      const usage = message?.usage as Record<string, unknown> | undefined;
      if (message?.role === "assistant" && usage) {
        summary.assistantCall = true;
        summary.stopReason = String(message.stopReason ?? "");
        const content = Array.isArray(message.content) ? message.content : [];
        summary.toolCalls = content.filter(
          (part) => typeof part === "object" && part !== null && (part as Record<string, unknown>).type === "toolCall",
        ).length;
        console.log(
          `[pi] model call completed: input=${String(usage.input ?? 0)} output=${String(usage.output ?? 0)}`,
        );
      }
    }
  } catch {
    // The unmodified line remains in the raw JSONL evidence.
  }
  return summary;
}

export class PiToolBudget {
  readonly maxSuccessfulTools: number;
  successfulTools = 0;
  limitReached = false;

  constructor(maxSuccessfulTools = Number.POSITIVE_INFINITY) {
    if (!(maxSuccessfulTools > 0)) throw new Error("maxSuccessfulTools must be greater than zero");
    this.maxSuccessfulTools = maxSuccessfulTools;
  }

  observe(summary: EventSummary): boolean {
    if (summary.toolExecutionEnded && summary.toolExecutionSucceeded) this.successfulTools += 1;
    this.limitReached = this.successfulTools >= this.maxSuccessfulTools;
    return this.limitReached;
  }
}

/** A repeated successful write is progress, but cannot substitute for another required file. */
export class PiFileCompletion {
  private readonly required: Set<string>;
  private readonly pending = new Map<string, string>();
  private readonly completed = new Set<string>();
  private pendingResponseTools = 0;

  constructor(private readonly cwd: string, requiredPaths: readonly string[] = []) {
    this.required = new Set(requiredPaths.map((file) => path.resolve(cwd, file)));
  }

  get complete(): boolean {
    return this.required.size > 0 && this.pendingResponseTools === 0 &&
      [...this.required].every((file) => this.completed.has(file));
  }

  get completedFiles(): string[] {
    return [...this.completed].map((file) => path.relative(this.cwd, file)).sort();
  }

  observe(summary: EventSummary): boolean {
    if (summary.assistantCall) this.pendingResponseTools = summary.toolCalls;
    if (summary.toolExecutionStarted && summary.toolCallId && summary.toolPath &&
        (summary.toolName === "write" || summary.toolName === "edit")) {
      const file = path.resolve(this.cwd, summary.toolPath);
      if (this.required.has(file)) this.pending.set(summary.toolCallId, file);
    }
    if (summary.toolExecutionEnded && summary.toolCallId) {
      const file = this.pending.get(summary.toolCallId);
      this.pending.delete(summary.toolCallId);
      if (file && summary.toolExecutionSucceeded) this.completed.add(file);
    }
    if (summary.toolExecutionEnded && this.pendingResponseTools > 0) this.pendingResponseTools -= 1;
    return this.complete;
  }
}

/** Explicit handoffs stop after the current tool batch, independently of how many edits were needed. */
export class PiToolHandoff {
  private readonly pending = new Map<string, string>();
  private pendingResponseTools = 0;
  completionTool: string | undefined;

  constructor(private readonly toolNames: readonly string[] = []) {}

  get complete(): boolean {
    return this.completionTool !== undefined && this.pendingResponseTools === 0;
  }

  observe(summary: EventSummary): boolean {
    if (summary.assistantCall) this.pendingResponseTools = summary.toolCalls;
    if (summary.toolExecutionStarted && summary.toolCallId && summary.toolName && this.toolNames.includes(summary.toolName)) {
      this.pending.set(summary.toolCallId, summary.toolName);
    }
    if (summary.toolExecutionEnded) {
      if (summary.toolCallId) {
        const tool = this.pending.get(summary.toolCallId);
        this.pending.delete(summary.toolCallId);
        if (tool && summary.toolExecutionSucceeded) this.completionTool = tool;
      }
      if (this.pendingResponseTools > 0) this.pendingResponseTools -= 1;
    }
    return this.complete;
  }
}

export class PiResponseBudget {
  readonly maxModelCalls: number;
  modelCalls = 0;
  callLimitReached = false;
  safeLimitStop = false;
  unsafeIncompleteStop = false;
  private pendingToolsAtLimit = 0;

  constructor(maxModelCalls: number) {
    if (!(maxModelCalls > 0)) throw new Error("maxModelCalls must be greater than zero");
    this.maxModelCalls = maxModelCalls;
  }

  observe(summary: EventSummary): boolean {
    if (summary.assistantCall) {
      this.modelCalls += 1;
      this.unsafeIncompleteStop = summary.stopReason === "length" && summary.toolCalls === 0;
      if (this.modelCalls >= this.maxModelCalls) {
        this.callLimitReached = true;
        this.pendingToolsAtLimit = summary.toolCalls;
        this.safeLimitStop = summary.stopReason === "stop" || summary.toolCalls > 0;
      }
    } else if (summary.toolExecutionEnded && this.callLimitReached && this.pendingToolsAtLimit > 0) {
      this.pendingToolsAtLimit -= 1;
    }
    return this.callLimitReached && this.pendingToolsAtLimit === 0;
  }
}

export async function runPi(
  args: string[],
  cwd: string,
  eventFile: string,
  stderrFile: string,
  timeoutMs: number,
  environment: NodeJS.ProcessEnv = process.env,
  maxModelCalls = Number.POSITIVE_INFINITY,
  maxSuccessfulTools = Number.POSITIVE_INFINITY,
  requiredPaths: readonly string[] = [],
  completionTools: readonly string[] = [],
): Promise<CommandResult> {
  const budget = new PiResponseBudget(maxModelCalls);
  const toolBudget = new PiToolBudget(maxSuccessfulTools);
  const completion = new PiFileCompletion(cwd, requiredPaths);
  const handoff = new PiToolHandoff(completionTools);
  const events = createWriteStream(eventFile, { flags: "wx" });
  const errors = createWriteStream(stderrFile, { flags: "wx" });
  let lineBuffer = "";
  let piChild: ReturnType<typeof spawn> | undefined;

  try {
    return await new Promise<CommandResult>((resolve, reject) => {
      const piBinary = path.join(
        REPOSITORY_ROOT,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "pi.cmd" : "pi",
      );
      const child = spawn(piBinary, args, {
        cwd,
        detached: usesDetachedProcessGroup(),
        env: {
          ...environment, PI_OFFLINE: "1",
          // Per invocation, including retries. The global response budget is
          // still response-based; this prevents extra dispatch during shutdown.
          SYSTEM_V0_MAX_PROVIDER_REQUESTS: Number.isFinite(maxModelCalls) ? String(Math.ceil(maxModelCalls)) : undefined,
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      piChild = child;
      let timedOut = false;
      let killTimer: NodeJS.Timeout | undefined;
      let stopRequested = false;
      const requestStop = (): void => {
        if (stopRequested) return;
        stopRequested = true;
        // Repeated SIGTERM can interrupt Pi's asynchronous disposal while it
        // drains shutdown hooks. Keep observing evidence, but signal only once.
        signalProcessTree(child, "SIGTERM");
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        requestStop();
        killTimer = setTimeout(() => signalProcessTree(child, "SIGKILL"), 5_000);
      }, timeoutMs);

      const processEventLine = (line: string): void => {
        const summary = summarizeEventLine(line);
        // Observe every event in every tracker; short-circuiting loses final-call evidence.
        const responseStop = budget.observe(summary);
        const toolStop = toolBudget.observe(summary);
        const filesComplete = completion.observe(summary);
        const handedOff = handoff.observe(summary);
        if (responseStop || toolStop || filesComplete || handedOff) requestStop();
      };

      child.stdout.on("data", (chunk: Buffer) => {
        events.write(chunk);
        lineBuffer += chunk.toString("utf8");
        const lines = lineBuffer.split(/\r?\n/u);
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) processEventLine(line);
      });
      child.stderr.pipe(errors);
      child.stderr.pipe(process.stderr);
      child.once("error", (error) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        if (lineBuffer !== "") processEventLine(lineBuffer);
        const exitCode = timedOut
          ? 124
          : toolBudget.limitReached || completion.complete || handoff.complete
            ? 0
            : budget.unsafeIncompleteStop
            ? 1
            : budget.callLimitReached && budget.safeLimitStop
              ? 0
              : (code ?? 1);
        resolve({
          exitCode,
          timedOut,
          modelCalls: budget.modelCalls,
          callLimitReached: budget.callLimitReached,
          successfulToolCalls: toolBudget.successfulTools,
          toolLimitReached: toolBudget.limitReached,
          completedFiles: completion.completedFiles,
          requiredFilesComplete: completion.complete,
          ...(handoff.completionTool ? { completionTool: handoff.completionTool } : {}),
        });
      });
    });
  } finally {
    if (piChild) await terminateProcessTree(piChild);
    await Promise.all([
      new Promise<void>((resolve) => events.end(resolve)),
      new Promise<void>((resolve) => errors.end(resolve)),
    ]);
  }
}
