export const MAX_PROVIDER_RESPONSES = 32;
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_768;
// Installed Berget GLM-5.2 model override; the gateway still enforces its own limit.
export const MAX_CONFIGURABLE_OUTPUT_TOKENS = 32_768;

export function runLimitsFromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const raw = environment.CHALLENGE_MAX_OUTPUT_TOKENS ?? String(DEFAULT_MAX_OUTPUT_TOKENS);
  const value = Number(raw);
  if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > MAX_CONFIGURABLE_OUTPUT_TOKENS) {
    throw new Error(`CHALLENGE_MAX_OUTPUT_TOKENS must be an integer from 1 to ${MAX_CONFIGURABLE_OUTPUT_TOKENS}`);
  }
  return {
    max_provider_responses: MAX_PROVIDER_RESPONSES,
    max_output_tokens_per_response: value,
    max_total_output_tokens: MAX_PROVIDER_RESPONSES * value,
  };
}
