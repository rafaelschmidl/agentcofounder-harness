import { createBashTool } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const CONTROL_VARIABLE_PATTERN = /^(?:CHALLENGE_|QUALIFICATION_|BERGET_|AGENTCOFOUNDER_)/u;
const CREDENTIAL_VARIABLE_PATTERN = /(?:^|_)(?:API_KEY|AUTHORIZATION|PASSWORD|SECRET|CREDENTIAL|BEARER|ACCESS_TOKEN|REFRESH_TOKEN|ID_TOKEN)$/iu;

export const DEFAULT_EXECUTION_GUARDS = Object.freeze({
  maxProviderRequests: 12,
  maxOutputTokens: 4_096,
  maxRequestBytes: 128 * 1_024,
  maxProjectedCostEur: 2,
});

function positiveNumber(name, fallback, { integer = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be a positive ${integer ? "integer" : "number"}`);
  }
  return value;
}

function finiteRate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function executionGuardDecision(payload, model, overrides = {}) {
  const limits = {
    maxProviderRequests: overrides.maxProviderRequests ?? DEFAULT_EXECUTION_GUARDS.maxProviderRequests,
    maxOutputTokens: overrides.maxOutputTokens ?? DEFAULT_EXECUTION_GUARDS.maxOutputTokens,
    maxRequestBytes: overrides.maxRequestBytes ?? DEFAULT_EXECUTION_GUARDS.maxRequestBytes,
    maxProjectedCostEur: overrides.maxProjectedCostEur ?? DEFAULT_EXECUTION_GUARDS.maxProjectedCostEur,
    expectedModel: overrides.expectedModel ?? null,
  };
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return { accepted: false, reason: "request-not-json-serializable", ...limits };
  }
  const requestBytes = typeof serialized === "string"
    ? Buffer.byteLength(serialized, "utf8")
    : null;
  const selectedModel = typeof model?.id === "string" ? model.id : null;
  const provider = typeof model?.provider === "string" ? model.provider : null;
  const inputRatePerMillion = finiteRate(model?.cost?.input) ? model.cost.input : null;
  const outputRatePerMillion = finiteRate(model?.cost?.output) ? model.cost.output : null;
  const projectedInputCostEur = inputRatePerMillion === null
    ? null
    : limits.maxRequestBytes * limits.maxProviderRequests * inputRatePerMillion / 1e6;
  const projectedOutputCostEur = outputRatePerMillion === null
    ? null
    : limits.maxOutputTokens * limits.maxProviderRequests * outputRatePerMillion / 1e6;
  const projectedTotalCostEur = projectedInputCostEur === null || projectedOutputCostEur === null
    ? null
    : projectedInputCostEur + projectedOutputCostEur;
  const evidence = {
    requestBytes,
    requestByteLimit: limits.maxRequestBytes,
    selectedModel,
    expectedModel: limits.expectedModel,
    provider,
    maxProviderRequests: limits.maxProviderRequests,
    maxOutputTokens: limits.maxOutputTokens,
    inputRatePerMillion,
    outputRatePerMillion,
    projectedInputCostEur,
    projectedOutputCostEur,
    projectedTotalCostEur,
    maxProjectedCostEur: limits.maxProjectedCostEur,
  };
  if (requestBytes === null) return { accepted: false, reason: "request-not-json-object", ...evidence };
  if (requestBytes > limits.maxRequestBytes) {
    return { accepted: false, reason: "request-byte-limit-exceeded", ...evidence };
  }
  if (provider !== "berget") {
    return { accepted: false, reason: "selected-provider-unexpected", ...evidence };
  }
  if (limits.expectedModel && selectedModel !== limits.expectedModel) {
    return { accepted: false, reason: "selected-model-unexpected", ...evidence };
  }
  if (projectedTotalCostEur === null) {
    return { accepted: false, reason: "pricing-metadata-missing", ...evidence };
  }
  if (projectedTotalCostEur > limits.maxProjectedCostEur) {
    return { accepted: false, reason: "projected-cost-limit-exceeded", ...evidence };
  }
  return { accepted: true, reason: "accepted", ...evidence };
}

async function appendObservation(value) {
  const path = process.env.AGENTCOFOUNDER_RUNTIME_OBSERVATION;
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** Strip runtime controls and provider-neutral credential names from bash. */
export function guardBashEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) =>
      !CONTROL_VARIABLE_PATTERN.test(name) && !CREDENTIAL_VARIABLE_PATTERN.test(name),
    ),
  );
}

export default function runtimeGuardExtension(pi) {
  const limits = {
    maxProviderRequests: positiveNumber(
      "AGENTCOFOUNDER_MAX_PROVIDER_REQUESTS",
      DEFAULT_EXECUTION_GUARDS.maxProviderRequests,
      { integer: true },
    ),
    maxOutputTokens: positiveNumber(
      "AGENTCOFOUNDER_MAX_OUTPUT_TOKENS",
      DEFAULT_EXECUTION_GUARDS.maxOutputTokens,
      { integer: true },
    ),
    maxRequestBytes: positiveNumber(
      "AGENTCOFOUNDER_MAX_REQUEST_BYTES",
      DEFAULT_EXECUTION_GUARDS.maxRequestBytes,
      { integer: true },
    ),
    maxProjectedCostEur: positiveNumber(
      "AGENTCOFOUNDER_MAX_PROJECTED_COST_EUR",
      DEFAULT_EXECUTION_GUARDS.maxProjectedCostEur,
    ),
    expectedModel: process.env.AGENTCOFOUNDER_EXPECTED_MODEL ?? null,
  };
  let providerRequestCount = 0;
  pi.on("before_provider_request", async (event, context) => {
    providerRequestCount += 1;
    if (providerRequestCount > limits.maxProviderRequests) {
      await appendObservation({
        type: "provider_request_rejected",
        providerRequestIndex: providerRequestCount,
        reason: "provider-request-limit-exceeded",
      });
      context.abort();
      return event.payload;
    }
    const payload = event.payload && typeof event.payload === "object"
      ? { ...event.payload }
      : {};
    delete payload.max_completion_tokens;
    payload.max_tokens = limits.maxOutputTokens;
    const guard = executionGuardDecision(payload, context.model, limits);
    await appendObservation({
      type: "provider_request",
      providerRequestIndex: providerRequestCount,
      requestedThinking: process.env.CHALLENGE_THINKING ?? null,
      piSelectedThinking: context.thinkingLevel ?? null,
      serializedReasoningEffort:
        typeof payload.reasoning_effort === "string" ? payload.reasoning_effort : null,
      guard,
    });
    if (!guard.accepted) {
      context.abort();
      throw new Error(`Provider request rejected before inference: ${guard.reason}`);
    }
    return payload;
  });

  const bashTool = createBashTool(process.cwd(), {
    spawnHook: ({ command, cwd, env }) => ({
      command,
      cwd,
      env: guardBashEnvironment(env),
    }),
  });
  pi.registerTool(bashTool);
}
