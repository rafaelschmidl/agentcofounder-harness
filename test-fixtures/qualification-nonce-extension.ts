/**
 * Test-only Gate B fixture. It is not part of the submission/application API.
 * The nonce is supplied by the evaluator environment and is revealed only by
 * the first tool. A distinct second tool accepts the model's nonce-bearing
 * follow-up, verifies it, and writes the evaluator-selected artifact.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MAX_QUALIFICATION_OUTPUT_TOKENS = 1_024;
export const MAX_QUALIFICATION_REQUEST_BYTES = 64 * 1_024;
export const MAX_QUALIFICATION_PROVIDER_RESPONSES = 2;
export const EXPECTED_QUALIFICATION_MODEL = "Qwen/Qwen3.8-27B-FP8";

const COST_RATE_BASIS = "provider-0.3.2-pi-per-million-tokens";

type RequestGuardDecision = {
  accepted: boolean;
  reason: string;
  requestBytes: number | null;
  requestByteLimit: number;
  rateBasis: string;
  currencyAssumption: "EUR";
  providerConfirmedCurrency: null;
  inputRatePerMillion: number | null;
  outputRatePerMillion: number | null;
  cacheReadRatePerMillion: number | null;
  cacheWriteRatePerMillion: number | null;
  maxProviderResponses: number;
  maxOutputTokensPerResponse: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  projectedInputCostEur: number | null;
  projectedOutputCostEur: number | null;
  projectedTotalCostEur: number | null;
  selectedModelId: string | null;
  expectedModelId: string;
};

function rejectedDecision(
  reason: string,
  partial: Partial<RequestGuardDecision> = {},
): RequestGuardDecision {
  return {
    accepted: false,
    reason,
    requestBytes: null,
    requestByteLimit: MAX_QUALIFICATION_REQUEST_BYTES,
    rateBasis: COST_RATE_BASIS,
    currencyAssumption: "EUR",
    providerConfirmedCurrency: null,
    inputRatePerMillion: null,
    outputRatePerMillion: null,
    cacheReadRatePerMillion: null,
    cacheWriteRatePerMillion: null,
    maxProviderResponses: MAX_QUALIFICATION_PROVIDER_RESPONSES,
    maxOutputTokensPerResponse: MAX_QUALIFICATION_OUTPUT_TOKENS,
    maxInputTokens: MAX_QUALIFICATION_REQUEST_BYTES * MAX_QUALIFICATION_PROVIDER_RESPONSES,
    maxOutputTokens: MAX_QUALIFICATION_OUTPUT_TOKENS * MAX_QUALIFICATION_PROVIDER_RESPONSES,
    projectedInputCostEur: null,
    projectedOutputCostEur: null,
    projectedTotalCostEur: null,
    selectedModelId: null,
    expectedModelId: EXPECTED_QUALIFICATION_MODEL,
    ...partial,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finiteRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Inspect only the final serialized request size and the selected Pi model's
 * provider-0.3.2 cost projection. No payload or credential content is returned.
 */
export function qualificationRequestGuardDecision(
  payload: unknown,
  model: unknown,
): RequestGuardDecision {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return rejectedDecision("request-not-json-serializable");
  }
  if (typeof serialized !== "string") return rejectedDecision("request-not-json-object");
  const requestBytes = Buffer.byteLength(serialized, "utf8");
  if (requestBytes > MAX_QUALIFICATION_REQUEST_BYTES) {
    return rejectedDecision("request-byte-limit-exceeded", { requestBytes });
  }

  if (!isPlainRecord(model)) {
    return rejectedDecision("selected-model-missing-or-invalid", { requestBytes });
  }
  if (model.provider !== "berget" || model.api !== "openai-completions") {
    return rejectedDecision("selected-model-provider-shape-unexpected", { requestBytes });
  }
  if (model.id !== EXPECTED_QUALIFICATION_MODEL) {
    return rejectedDecision("selected-model-id-unexpected", {
      requestBytes,
      selectedModelId: typeof model.id === "string" ? model.id : null,
    });
  }
  const cost = isPlainRecord(model.cost) ? model.cost : {};
  const input = cost.input;
  const output = cost.output;
  const cacheRead = cost.cacheRead;
  const cacheWrite = cost.cacheWrite;
  const rates = {
    requestBytes,
    selectedModelId: model.id,
    inputRatePerMillion: finiteRate(input) ? input : null,
    outputRatePerMillion: finiteRate(output) ? output : null,
    cacheReadRatePerMillion: finiteRate(cacheRead) ? cacheRead : null,
    cacheWriteRatePerMillion: finiteRate(cacheWrite) ? cacheWrite : null,
  };
  const maxInputTokens = MAX_QUALIFICATION_REQUEST_BYTES * MAX_QUALIFICATION_PROVIDER_RESPONSES;
  const maxOutputTokens = MAX_QUALIFICATION_OUTPUT_TOKENS * MAX_QUALIFICATION_PROVIDER_RESPONSES;
  const projectedInputCostEur = finiteRate(input)
    ? maxInputTokens * input / 1e6
    : null;
  const projectedOutputCostEur = finiteRate(output)
    ? maxOutputTokens * output / 1e6
    : null;
  const projectedTotalCostEur = Number.isFinite(projectedInputCostEur) &&
      Number.isFinite(projectedOutputCostEur)
    ? projectedInputCostEur + projectedOutputCostEur
    : null;
  const projection = {
    ...rates,
    maxProviderResponses: MAX_QUALIFICATION_PROVIDER_RESPONSES,
    maxOutputTokensPerResponse: MAX_QUALIFICATION_OUTPUT_TOKENS,
    maxInputTokens,
    maxOutputTokens,
    projectedInputCostEur: Number.isFinite(projectedInputCostEur) ? projectedInputCostEur : null,
    projectedOutputCostEur: Number.isFinite(projectedOutputCostEur) ? projectedOutputCostEur : null,
    projectedTotalCostEur: Number.isFinite(projectedTotalCostEur) ? projectedTotalCostEur : null,
  };
  return {
    ...rejectedDecision("accepted", projection),
    accepted: true,
  };
}

async function appendRuntimeObservation(value: Record<string, unknown>) {
  const path = process.env.QUALIFICATION_RUNTIME_OBSERVATION;
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

export default function qualificationNonceExtension(pi: ExtensionAPI) {
  let revealCount = 0;
  let persistCount = 0;
  let providerRequestCount = 0;

  pi.on("before_provider_request", async (event, ctx) => {
    providerRequestCount += 1;
    if (providerRequestCount > MAX_QUALIFICATION_PROVIDER_RESPONSES) {
      ctx.abort();
      return event.payload;
    }
    const payload = event.payload && typeof event.payload === "object"
      ? { ...(event.payload as Record<string, unknown>) }
      : {};
    delete payload.max_completion_tokens;
    payload.max_tokens = MAX_QUALIFICATION_OUTPUT_TOKENS;
    const guard = qualificationRequestGuardDecision(payload, ctx.model);
    await appendRuntimeObservation({
      type: "provider_request",
      providerRequestIndex: providerRequestCount,
      requestedThinking: process.env.CHALLENGE_THINKING ?? null,
      piSelectedThinking: ctx.thinkingLevel ?? null,
      serializedReasoningEffort:
        typeof payload.reasoning_effort === "string" ? payload.reasoning_effort : null,
      providerConfirmedEffective: null,
      maxOutputTokens: MAX_QUALIFICATION_OUTPUT_TOKENS,
      requestGuard: guard,
    });
    if (!guard.accepted) {
      ctx.abort();
      throw new Error(`Qualification request rejected before inference: ${guard.reason}`);
    }
    return payload;
  });

  pi.on("after_provider_response", async (event) => {
    const effective = event.headers["x-reasoning-effort"] ?? event.headers["x-thinking-level"];
    if (effective) {
      await appendRuntimeObservation({
        type: "provider_response",
        providerConfirmedEffective: effective,
      });
    }
  });

  pi.registerTool({
    name: "reveal_qualification_nonce",
    label: "Reveal qualification nonce",
    description: "Reveal the hidden qualification nonce. Call this first and exactly once.",
    parameters: Type.Object({
      confirmation: Type.String(),
    }),
    async execute() {
      revealCount += 1;
      if (revealCount !== 1 || persistCount !== 0) {
        return {
          content: [{ type: "text", text: "Qualification tool order violation." }],
          details: { phase: "reveal", valid: false },
          isError: true,
          terminate: true,
        };
      }
      const nonce = process.env.QUALIFICATION_NONCE;
      if (!nonce) {
        return {
          content: [{ type: "text", text: "Qualification fixture is not configured." }],
          details: { phase: "reveal", configured: false },
          isError: true,
          terminate: true,
        };
      }
      return {
        content: [{ type: "text", text: nonce }],
        details: { phase: "reveal", configured: true },
      };
    },
  });

  pi.registerTool({
    name: "persist_qualification_nonce",
    label: "Persist qualification nonce",
    description:
      "Persist the exact nonce returned by reveal_qualification_nonce. Call this second and exactly once.",
    parameters: Type.Object({ nonce: Type.String() }),
    async execute(_toolCallId, params) {
      persistCount += 1;
      const expected = process.env.QUALIFICATION_NONCE;
      const artifact = process.env.QUALIFICATION_ARTIFACT;
      const valid = revealCount === 1 && persistCount === 1 && params.nonce === expected;
      if (!valid || !expected || !artifact) {
        return {
          content: [{ type: "text", text: "Qualification nonce validation failed." }],
          details: { phase: "persist", exactMatch: false, artifactWritten: false },
          isError: true,
          terminate: true,
        };
      }
      await mkdir(dirname(artifact), { recursive: true });
      await writeFile(artifact, `${expected}\n`, { encoding: "utf8", mode: 0o600 });
      return {
        content: [{ type: "text", text: "Qualification nonce persisted." }],
        details: { phase: "persist", exactMatch: true, artifactWritten: true },
        terminate: true,
      };
    },
  });
}
