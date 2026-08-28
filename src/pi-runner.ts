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
}

export interface EventSummary {
  assistantCall: boolean;
  stopReason: string;
  toolCalls: number;
  toolExecutionEnded: boolean;
}

export function summarizeEventLine(line: string): EventSummary {
  const summary: EventSummary = {
    assistantCall: false,
    stopReason: "",
    toolCalls: 0,
    toolExecutionEnded: false,
  };
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type === "tool_execution_end") {
      summary.toolExecutionEnded = true;
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

export class PiResponseBudget {
  readonly maxModelCalls: number;
  modelCalls = 0;
  callLimitReached = false;
  safeLimitStop = false;
  private pendingToolsAtLimit = 0;

  constructor(maxModelCalls: number) {
    if (!(maxModelCalls > 0)) throw new Error("maxModelCalls must be greater than zero");
    this.maxModelCalls = maxModelCalls;
  }

  observe(summary: EventSummary): boolean {
    if (summary.assistantCall) {
      this.modelCalls += 1;
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
): Promise<CommandResult> {
  const budget = new PiResponseBudget(maxModelCalls);
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
        env: { ...environment, PI_OFFLINE: "1" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      piChild = child;
      let timedOut = false;
      let killTimer: NodeJS.Timeout | undefined;
      const timeout = setTimeout(() => {
        timedOut = true;
        signalProcessTree(child, "SIGTERM");
        killTimer = setTimeout(() => signalProcessTree(child, "SIGKILL"), 5_000);
      }, timeoutMs);

      const processEventLine = (line: string): void => {
        const summary = summarizeEventLine(line);
        if (budget.observe(summary)) signalProcessTree(child, "SIGTERM");
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
        const exitCode = timedOut ? 124 : budget.callLimitReached && budget.safeLimitStop ? 0 : (code ?? 1);
        resolve({
          exitCode,
          timedOut,
          modelCalls: budget.modelCalls,
          callLimitReached: budget.callLimitReached,
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
