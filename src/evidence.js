import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const SENSITIVE_KEY_PATTERN = /^(?:(?:[a-z0-9]+[-_])?api[-_]?key|authorization|password|secret|credential|bearer|access[-_]?token|refresh[-_]?token|id[-_]?token)$/iu;
const GENERIC_SECRET_PATTERNS = [
  /(\b[A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|ID_TOKEN|PASSWORD|SECRET|CREDENTIAL)\s*[=:]\s*)([^\s,}"']+)/gu,
  /(authorization\s*:\s*bearer\s+)([^\s,}"']+)/giu,
  /("(?:api[_-]?key|authorization|password|secret|credential|bearer|access[_-]?token|refresh[_-]?token|id[_-]?token)"\s*:\s*")([^"\\]+)/giu,
];

export function redactText(value, secrets = []) {
  let result = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      result = result.split(secret).join("[REDACTED]");
    }
  }
  for (const pattern of GENERIC_SECRET_PATTERNS) {
    result = result.replace(pattern, "$1[REDACTED]");
  }
  return result;
}

export function redactValue(value, secrets = [], key = "") {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childValue, secrets, childKey),
      ]),
    );
  }
  return value;
}

export function parseJsonLines(value, secrets = []) {
  return String(value ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return redactValue(JSON.parse(line), secrets);
      } catch {
        return { raw: redactText(line, secrets), parseError: true };
      }
    });
}

export function observedRuntimeMetadata(events) {
  const result = { provider: null, model: null, thinking: null };
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string") {
        if (result.provider === null && /^(provider|providerId)$/iu.test(key)) result.provider = child;
        if (result.model === null && /^(model|modelId)$/iu.test(key)) result.model = child;
        if (result.thinking === null && /^(thinking|thinkingLevel)$/iu.test(key)) result.thinking = child;
      } else {
        visit(child);
      }
    }
  };
  for (const event of events) visit(event);
  return result;
}

export async function copyTreeContents(source, destination, { secrets = [] } = {}) {
  let entries;
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch {
    return false;
  }
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyTreeContents(from, to, { secrets });
    } else if (entry.isFile()) {
      const content = await readFile(from);
      const text = redactText(content.toString("utf8"), secrets);
      await writeFile(to, text, "utf8");
    }
  }
  return true;
}

export async function writeRuntimeEvidence(
  evidenceDirectory,
  {
    configuration,
    invocation,
    result,
    secrets = [],
    extra = {},
  },
) {
  await mkdir(evidenceDirectory, { recursive: true });
  const events = parseJsonLines(result?.stdout ?? "", secrets);
  const payload = redactValue(
    {
      status: result?.code === 0 && !result?.timedOut ? "success" : "failure",
      requestedRuntime: {
        provider: configuration.provider,
        model: configuration.model,
        thinking: configuration.thinking,
      },
      observedRuntime: observedRuntimeMetadata(events),
      invocation,
      process: result
        ? {
            code: result.code,
            signal: result.signal,
            timedOut: result.timedOut,
            termSent: result.termSent,
            killSent: result.killSent,
            startedAt: result.startedAt,
            endedAt: result.endedAt,
            durationMs: result.durationMs,
          }
        : null,
      ...extra,
    },
    secrets,
  );
  await writeFile(join(evidenceDirectory, "runtime.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(join(evidenceDirectory, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  await writeFile(join(evidenceDirectory, "stdout.log"), redactText(result?.stdout ?? "", secrets));
  await writeFile(join(evidenceDirectory, "stderr.log"), redactText(result?.stderr ?? "", secrets));
  return payload;
}

export function safeEvidenceFilename(value) {
  return basename(String(value)).replace(/[^a-z0-9._-]/giu, "_");
}
