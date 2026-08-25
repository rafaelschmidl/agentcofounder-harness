import { join, resolve } from "node:path";
import { readRuntimeConfiguration } from "./config.js";
import { writeRuntimeEvidence } from "./evidence.js";
import {
  buildPiEnvironment,
  buildPiInvocation,
  invocationMetadata,
  preparePiRuntimeState,
  runPiInvocation,
} from "./pi-runner.js";

export function resolveRuntimeStatePaths(workspaceRoot, environment = {}) {
  const resolvedWorkspace = resolve(workspaceRoot);
  const runtimeRoot = resolve(
    environment.AGENTCOFOUNDER_ISOLATION_ROOT || join(resolvedWorkspace, ".pi-runtime"),
  );
  return {
    runtimeRoot,
    homeDir: join(runtimeRoot, "home"),
    agentDir: join(runtimeRoot, "pi-agent"),
    sessionDir: join(runtimeRoot, "pi-agent", "sessions"),
    xdgConfigDir: join(runtimeRoot, "xdg-config"),
    xdgCacheDir: join(runtimeRoot, "xdg-cache"),
    xdgDataDir: join(runtimeRoot, "xdg-data"),
    xdgStateDir: join(runtimeRoot, "xdg-state"),
  };
}

export async function executeConfiguredPi({
  environment = process.env,
  configuration,
  prompt,
  workspaceRoot,
  qualification = false,
  qualificationExtension,
  timeoutMs,
  outputLimitBytes,
} = {}) {
  const resolvedConfiguration = configuration ?? readRuntimeConfiguration(environment, {
    requireCredential: true,
  });
  const resolvedWorkspace = resolve(workspaceRoot);
  const { runtimeRoot, ...runtimeState } = resolveRuntimeStatePaths(resolvedWorkspace, environment);
  await preparePiRuntimeState(runtimeState);
  const childEnvironment = buildPiEnvironment(
    environment,
    resolvedConfiguration,
    runtimeState,
    { qualification },
  );
  const invocation = buildPiInvocation(resolvedConfiguration, {
    cwd: resolvedWorkspace,
    prompt,
    sessionDir: runtimeState.sessionDir,
    qualification,
    qualificationExtension,
  });
  const result = await runPiInvocation(invocation, {
    environment: childEnvironment,
    timeoutMs,
    outputLimitBytes,
  });
  const secrets = resolvedConfiguration.berget.credentialPresent
    ? [environment.BERGET_API_KEY]
    : [];
  await writeRuntimeEvidence(join(resolvedWorkspace, "evidence"), {
    configuration: resolvedConfiguration,
    invocation: invocationMetadata(invocation),
    result,
    secrets,
    extra: {
      workspace: resolvedWorkspace,
      runtimeState: {
        runtimeRoot,
        ...runtimeState,
        retry: false,
        compaction: false,
      },
    },
  });
  return {
    childEnvironment,
    configuration: resolvedConfiguration,
    invocation,
    result,
    runtimeState,
    secrets,
  };
}
