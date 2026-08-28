import { appendFile, writeFile } from "node:fs/promises";

export interface TraceEvent {
  sequence: number;
  at: string;
  stage: string;
  status: "started" | "completed" | "failed" | "decision";
  summary: string;
  evidence?: Record<string, unknown>;
}

export class RunTrace {
  private sequence = 0;

  private constructor(private readonly file: string) {}

  static async create(file: string): Promise<RunTrace> {
    await writeFile(file, "", { encoding: "utf8", flag: "wx" });
    return new RunTrace(file);
  }

  async record(
    stage: string,
    status: TraceEvent["status"],
    summary: string,
    evidence?: Record<string, unknown>,
  ): Promise<TraceEvent> {
    this.sequence += 1;
    const event: TraceEvent = {
      sequence: this.sequence,
      at: new Date().toISOString(),
      stage,
      status,
      summary,
      ...(evidence ? { evidence } : {}),
    };
    await appendFile(this.file, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }
}
