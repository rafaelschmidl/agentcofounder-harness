import { appendFile } from "node:fs/promises";
import type { PatternRetrievalResult } from "./catalog.js";

export interface PatternRetrievalAuditEvent extends PatternRetrievalResult {
  type: "pattern_retrieval";
}

export async function appendPatternRetrievalAudit(
  file: string,
  result: PatternRetrievalResult,
): Promise<PatternRetrievalAuditEvent> {
  const event: PatternRetrievalAuditEvent = { type: "pattern_retrieval", ...result };
  await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}
