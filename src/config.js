import { URL } from "node:url";
import { isAbsolute } from "node:path";

export const THINKING_LEVELS = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const RUNTIME_ENVIRONMENT_NAMES = Object.freeze([
  "CHALLENGE_PROVIDER",
  "CHALLENGE_MODEL",
  "CHALLENGE_THINKING",
  "BERGET_API_KEY",
  "BERGET_API_URL",
  "BERGET_INFERENCE_URL",
]);

export const EXECUTION_GUARD_ENVIRONMENT_NAMES = Object.freeze([
  "AGENTCOFOUNDER_EXPECTED_MODEL",
  "AGENTCOFOUNDER_MAX_PROVIDER_REQUESTS",
  "AGENTCOFOUNDER_MAX_OUTPUT_TOKENS",
  "AGENTCOFOUNDER_MAX_REQUEST_BYTES",
  "AGENTCOFOUNDER_MAX_PROJECTED_COST_EUR",
  "AGENTCOFOUNDER_RUNTIME_OBSERVATION",
]);

export const QUALIFICATION_ENVIRONMENT_NAMES = Object.freeze([
  "QUALIFICATION_NONCE",
  "QUALIFICATION_ARTIFACT",
  "QUALIFICATION_RUNTIME_OBSERVATION",
]);

export const SYSTEM_ENVIRONMENT_NAMES = Object.freeze([
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
]);

const BERGET_THINKING_CAPABILITIES = Object.freeze({
  // @bergetai/pi-provider 0.3.2 explicitly establishes this model's map.
  "Qwen/Qwen3.8-27B-FP8": Object.freeze(["off", "low", "medium", "xhigh"]),
});

export class RuntimeConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

export function validateQualificationEnvironment(environment) {
  const result = {};
  for (const name of QUALIFICATION_ENVIRONMENT_NAMES) {
    const value = environment[name];
    if (typeof value !== "string" || value.trim() === "") {
      throw new RuntimeConfigurationError(`${name} is required for the qualification fixture`);
    }
    if (/[\u0000-\u001f\u007f]/u.test(value)) {
      throw new RuntimeConfigurationError(`${name} must not contain control characters`);
    }
    result[name] = value;
  }
  if (!/^[a-f0-9]{48}$/u.test(result.QUALIFICATION_NONCE)) {
    throw new RuntimeConfigurationError(
      "QUALIFICATION_NONCE must be 48 lowercase hexadecimal characters",
    );
  }
  for (const name of ["QUALIFICATION_ARTIFACT", "QUALIFICATION_RUNTIME_OBSERVATION"]) {
    if (!isAbsolute(result[name])) {
      throw new RuntimeConfigurationError(`${name} must be an absolute path`);
    }
  }
  return result;
}

function readRequiredEnvironment(name, environment) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new RuntimeConfigurationError(`${name} is required`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RuntimeConfigurationError(`${name} must not contain control characters`);
  }
  return value.trim();
}

function validateProvider(value) {
  if (!/^[a-z][a-z0-9._-]*$/u.test(value)) {
    throw new RuntimeConfigurationError(
      "CHALLENGE_PROVIDER must contain only lowercase letters, numbers, '.', '_' or '-'",
    );
  }
  return value;
}

function validateModel(value) {
  if (/\s/u.test(value) || value.length > 512) {
    throw new RuntimeConfigurationError(
      "CHALLENGE_MODEL must be a non-empty model identifier without whitespace",
    );
  }
  return value;
}

function validateEndpoint(name, value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RuntimeConfigurationError(`${name} must be a valid HTTP(S) URL`);
  }
  if (value.trim() === "") return undefined;
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RuntimeConfigurationError(`${name} must be a valid HTTP(S) URL`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new RuntimeConfigurationError(`${name} must be a valid HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new RuntimeConfigurationError(`${name} must be a valid HTTP(S) URL`);
  }
  return parsed.toString().replace(/\/$/u, "");
}

export function supportedThinkingLevels(provider, model) {
  const normalizedModel = provider === "berget"
    ? model.replace(/^berget\//u, "")
    : model;
  if (provider === "berget" && BERGET_THINKING_CAPABILITIES[normalizedModel]) {
    return [...BERGET_THINKING_CAPABILITIES[normalizedModel]];
  }
  // Never let Pi silently clamp an unestablished model capability. Unknown
  // provider/model pairs are conservative and may opt out of thinking only.
  return ["off"];
}

function validateThinkingCapability(provider, model, thinking) {
  const supported = supportedThinkingLevels(provider, model);
  if (!supported.includes(thinking)) {
    throw new RuntimeConfigurationError(
      `CHALLENGE_THINKING=${thinking} is not supported for CHALLENGE_PROVIDER=${provider} ` +
      `CHALLENGE_MODEL=${model}; supported: ${supported.join(", ")}`,
    );
  }
  return thinking;
}

/**
 * Parse the small runtime contract consumed by the Pi execution seam.
 *
 * Credentials are intentionally represented only by their presence and are
 * never returned as part of the public metadata object.
 */
export function readRuntimeConfiguration(
  environment = process.env,
  { requireCredential = true } = {},
) {
  const provider = validateProvider(readRequiredEnvironment("CHALLENGE_PROVIDER", environment));
  const model = validateModel(readRequiredEnvironment("CHALLENGE_MODEL", environment));
  const requestedThinking = readRequiredEnvironment("CHALLENGE_THINKING", environment);

  if (!THINKING_LEVELS.includes(requestedThinking)) {
    throw new RuntimeConfigurationError(
      `CHALLENGE_THINKING must be one of: ${THINKING_LEVELS.join(", ")}`,
    );
  }
  const thinking = validateThinkingCapability(provider, model, requestedThinking);

  const apiUrl = validateEndpoint("BERGET_API_URL", environment.BERGET_API_URL);
  const inferenceUrl = validateEndpoint("BERGET_INFERENCE_URL", environment.BERGET_INFERENCE_URL);
  const credential = environment.BERGET_API_KEY;

  if (provider === "berget" && requireCredential && (typeof credential !== "string" || credential.trim() === "")) {
    throw new RuntimeConfigurationError("BERGET_API_KEY is required when CHALLENGE_PROVIDER=berget");
  }
  if (typeof credential === "string" && /[\u0000-\u001f\u007f]/u.test(credential)) {
    throw new RuntimeConfigurationError("BERGET_API_KEY must not contain control characters");
  }

  return {
    provider,
    model,
    thinking,
    berget: {
      apiUrl,
      inferenceUrl,
      credentialPresent: typeof credential === "string" && credential.trim().length > 0,
      credentialEnvironmentName: "BERGET_API_KEY",
    },
  };
}

export function runtimeConfigurationMetadata(configuration) {
  return {
    provider: configuration.provider,
    model: configuration.model,
    thinking: configuration.thinking,
    berget: {
      apiUrl: configuration.berget?.apiUrl ?? null,
      inferenceUrl: configuration.berget?.inferenceUrl ?? null,
      credentialPresent: configuration.berget?.credentialPresent === true,
      credentialEnvironmentName: "BERGET_API_KEY",
    },
  };
}

export function getRuntimeEnvironment(configuration, environment = process.env) {
  const result = {};
  for (const name of [...RUNTIME_ENVIRONMENT_NAMES, ...EXECUTION_GUARD_ENVIRONMENT_NAMES]) {
    if (typeof environment[name] === "string") result[name] = environment[name];
  }
  result.CHALLENGE_PROVIDER = configuration.provider;
  result.CHALLENGE_MODEL = configuration.model;
  result.CHALLENGE_THINKING = configuration.thinking;
  return result;
}

export function getSystemEnvironment(environment = process.env) {
  const result = {};
  for (const name of SYSTEM_ENVIRONMENT_NAMES) {
    if (typeof environment[name] === "string") result[name] = environment[name];
  }
  return result;
}
