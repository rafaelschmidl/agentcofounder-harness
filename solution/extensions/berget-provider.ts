import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveOfficialBergetExtension } from "../../src/provider.js";
import { withProviderRequestTelemetry } from "../../src/provider-request-telemetry.js";

type Initializer = (pi: ExtensionAPI) => Promise<void>;
const MAX_STARTUP_ATTEMPTS = 3;

function transientCatalogFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // These are the errors emitted by the installed provider's startup GET.
  // Authentication, malformed metadata, and provider registration errors are
  // not repaired by retrying discovery.
  return (error instanceof TypeError && error.message === "fetch failed")
    || /^Failed to fetch models: (?:408|429|5\d\d)(?:\s|$)/u.test(error.message);
}

export async function initializeBergetWithRetry(
  pi: ExtensionAPI,
  initialize: Initializer,
  wait: (milliseconds: number) => Promise<unknown> = delay,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_STARTUP_ATTEMPTS; attempt++) {
    try {
      // The official initializer fetches the catalog before registering once.
      // It remains responsible for IDs, capabilities, pricing, auth, URL
      // overrides, refresh behavior, and inference. No model call happens here.
      await initialize(pi);
      return;
    } catch (error) {
      if (!transientCatalogFailure(error)) throw error;
      if (attempt === MAX_STARTUP_ATTEMPTS) {
        throw new Error(`Berget model catalog startup failed after ${attempt} attempts.`, { cause: error });
      }
      console.warn(`Berget model catalog unavailable; retrying startup (${attempt + 1}/${MAX_STARTUP_ATTEMPTS}).`);
      await wait(500 * attempt);
    }
  }
}

export default async function bergetProvider(pi: ExtensionAPI): Promise<void> {
  const installed = await import(pathToFileURL(resolveOfficialBergetExtension()).href) as { default: Initializer };
  const cap = process.env.SYSTEM_V0_MAX_PROVIDER_REQUESTS;
  await initializeBergetWithRetry(withProviderRequestTelemetry(pi, process.env.SYSTEM_V0_PROVIDER_REQUEST_LOG, process.env.SYSTEM_V0_ALLOWANCE_LEDGER, cap === undefined ? undefined : Number(cap)), installed.default);
}
