import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type RequestEntry = {
  id: string; stage_evidence: string; at: string; status: "reserved" | "unknown" | "measured";
  output_token_cap: number; reserved_cost: number; cost_total: number;
  input_tokens?: number; output_tokens?: number; settled_at?: string;
};
export type ProviderAllowance = {
  version: 1; currency: "EUR"; limit: number; baseline_cost: number; baseline_evidence: string;
  model_id: string; context_window: number; input_price_per_token: number; output_price_per_token: number;
  requests: RequestEntry[];
};

const microEurCeiling = (value: number) => Math.ceil(value * 1_000_000 - 1e-9);
export function allowanceTotal(ledger: ProviderAllowance): number {
  return (microEurCeiling(ledger.baseline_cost) + ledger.requests.reduce((sum, entry) => sum + microEurCeiling(entry.cost_total), 0)) / 1_000_000;
}

function validate(value: ProviderAllowance): void {
  if (value.version !== 1 || value.currency !== "EUR" || !Number.isFinite(value.limit) || value.limit <= 0
    || !Number.isFinite(value.baseline_cost) || value.baseline_cost < 0 || !value.baseline_evidence
    || !value.model_id || !Number.isInteger(value.context_window) || value.context_window <= 0
    || !Number.isFinite(value.input_price_per_token) || value.input_price_per_token <= 0
    || !Number.isFinite(value.output_price_per_token) || value.output_price_per_token <= 0
    || !Array.isArray(value.requests) || value.requests.some((entry) => !entry.id || !["reserved", "unknown", "measured"].includes(entry.status) || !Number.isFinite(entry.cost_total) || entry.cost_total < 0)
    || new Set(value.requests.map((entry) => entry.id)).size !== value.requests.length) {
    throw new Error("Invalid development allowance ledger; provider HTTP refused");
  }
}

async function mutate(path: string, update: (ledger: ProviderAllowance) => void): Promise<void> {
  const target = resolve(path);
  const lock = `${target}.lock`;
  const deadline = Date.now() + 5_000;
  while (true) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("Development allowance lock unavailable; provider HTTP refused");
      await delay(20);
    }
  }
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const ledger = JSON.parse(await readFile(target, "utf8")) as ProviderAllowance;
    validate(ledger);
    update(ledger);
    validate(ledger);
    await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

export async function reserveProviderRequest(path: string, request: { id: string; stageEvidence: string; modelId: string; contextWindow: number; outputTokenCap: number }): Promise<void> {
  await mutate(path, (ledger) => {
    if (request.modelId !== ledger.model_id || request.contextWindow !== ledger.context_window
      || !Number.isInteger(request.outputTokenCap) || request.outputTokenCap <= 0 || request.outputTokenCap > ledger.context_window) {
      throw new Error("Development allowance model or output limit mismatch; provider HTTP refused");
    }
    if (ledger.requests.some((entry) => entry.id === request.id)) throw new Error("Duplicate development allowance request");
    const ceilingMicros = microEurCeiling(ledger.context_window * ledger.input_price_per_token + request.outputTokenCap * ledger.output_price_per_token);
    const ceiling = ceilingMicros / 1_000_000;
    if (microEurCeiling(allowanceTotal(ledger)) + ceilingMicros > Math.floor(ledger.limit * 1_000_000 + 1e-9)) throw new Error("Development allowance exhausted; provider HTTP refused");
    ledger.requests.push({ id: request.id, stage_evidence: request.stageEvidence, at: new Date().toISOString(), status: "reserved", output_token_cap: request.outputTokenCap, reserved_cost: ceiling, cost_total: ceiling });
  });
}

/** Raw provider prompt_tokens already includes cached input: charge that total once at ordinary input price. */
export async function settleProviderRequest(path: string, requestId: string, usage: { inputTokens: number; outputTokens: number }): Promise<void> {
  if (!Number.isInteger(usage.inputTokens) || usage.inputTokens <= 0 || !Number.isInteger(usage.outputTokens) || usage.outputTokens < 0) throw new Error("Final provider usage is incomplete");
  await mutate(path, (ledger) => {
    const entry = ledger.requests.find((item) => item.id === requestId);
    if (!entry) throw new Error("Provider usage has no allowance reservation");
    if (entry.status === "measured") {
      if (entry.input_tokens !== usage.inputTokens || entry.output_tokens !== usage.outputTokens) throw new Error("Conflicting final provider usage");
      return;
    }
    // If a provider violates its documented cap, retain the actual larger charge;
    // all subsequent admissions then see it instead of concealing an overshoot.
    entry.cost_total = microEurCeiling(usage.inputTokens * ledger.input_price_per_token + usage.outputTokens * ledger.output_price_per_token) / 1_000_000;
    entry.input_tokens = usage.inputTokens;
    entry.output_tokens = usage.outputTokens;
    entry.status = "measured";
    entry.settled_at = new Date().toISOString();
  });
}

export async function markProviderRequestUnknown(path: string, requestId: string): Promise<void> {
  await mutate(path, (ledger) => {
    const entry = ledger.requests.find((item) => item.id === requestId);
    if (!entry) throw new Error("Unknown provider request has no allowance reservation");
    if (entry.status !== "measured") entry.status = "unknown";
  });
}

/** Explicit setup only; inference never creates or resets an allowance ledger. */
export async function initializeProviderAllowance(path: string, ledger: ProviderAllowance): Promise<void> {
  validate(ledger);
  if (ledger.requests.length !== 0 || ledger.baseline_cost > ledger.limit) throw new Error("New allowance requires an affordable audited baseline and no requests");
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}
