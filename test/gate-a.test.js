import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { stream as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import qualificationNonceExtension, {
  EXPECTED_QUALIFICATION_MODEL,
  MAX_QUALIFICATION_OUTPUT_TOKENS,
  MAX_QUALIFICATION_PROVIDER_RESPONSES,
  MAX_QUALIFICATION_REQUEST_BYTES,
  qualificationRequestGuardDecision,
} from "../test-fixtures/qualification-nonce-extension.ts";
import { resolveRuntimeStatePaths } from "../src/execution.js";
import {
  readRuntimeConfiguration,
  runtimeConfigurationMetadata,
  supportedThinkingLevels,
  validateQualificationEnvironment,
} from "../src/config.js";
import {
  buildPiEnvironment,
  buildPiInvocation,
  invocationMetadata,
  preparePiRuntimeState,
  QUALIFICATION_TOOL_NAMES,
  resolveBergetExtension,
  resolvePiCli,
  runPiInvocation,
} from "../src/pi-runner.js";
import { redactText, redactValue, writeRuntimeEvidence } from "../src/evidence.js";
import runtimeGuardExtension, {
  DEFAULT_EXECUTION_GUARDS,
  executionGuardDecision,
  guardBashEnvironment,
} from "../src/runtime-guard-extension.js";
import { buildChallengePrompt } from "../src/prompt.js";

const execFileAsync = promisify(execFile);

function bergetEnvironment(overrides = {}) {
  return {
    CHALLENGE_PROVIDER: "berget",
    CHALLENGE_MODEL: "Qwen/Qwen3.8-27B-FP8",
    CHALLENGE_THINKING: "medium",
    BERGET_API_KEY: "gate-a-sentinel-credential",
    ...overrides,
  };
}

function qualificationModel(costOverrides = {}, modelOverrides = {}) {
  return {
    provider: "berget",
    api: "openai-completions",
    id: EXPECTED_QUALIFICATION_MODEL,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0.30,
      output: 2.50,
      ...costOverrides,
    },
    ...modelOverrides,
  };
}

function jsonPayloadWithExactBytes(bytes) {
  const emptyBytes = Buffer.byteLength(JSON.stringify({ text: "" }), "utf8");
  const payload = { text: "x".repeat(bytes - emptyBytes) };
  assert.equal(Buffer.byteLength(JSON.stringify(payload), "utf8"), bytes);
  return payload;
}

test("runtime configuration is strict, sanitized, and preserves externally requested medium", () => {
  const configuration = readRuntimeConfiguration(bergetEnvironment());
  assert.deepEqual(runtimeConfigurationMetadata(configuration), {
    provider: "berget",
    model: "Qwen/Qwen3.8-27B-FP8",
    thinking: "medium",
    berget: {
      apiUrl: null,
      inferenceUrl: null,
      credentialPresent: true,
      credentialEnvironmentName: "BERGET_API_KEY",
    },
  });
  for (const name of ["CHALLENGE_PROVIDER", "CHALLENGE_MODEL", "CHALLENGE_THINKING"]) {
    assert.throws(
      () => readRuntimeConfiguration(bergetEnvironment({ [name]: undefined })),
      new RegExp(`${name} is required`, "u"),
    );
  }
  assert.throws(
    () => readRuntimeConfiguration(bergetEnvironment({ BERGET_API_KEY: undefined })),
    /BERGET_API_KEY is required when CHALLENGE_PROVIDER=berget/u,
  );
  assert.throws(
    () => readRuntimeConfiguration(bergetEnvironment({ CHALLENGE_PROVIDER: "Berget" })),
    /CHALLENGE_PROVIDER must contain only lowercase/u,
  );
  assert.throws(
    () => readRuntimeConfiguration(bergetEnvironment({ CHALLENGE_MODEL: "bad model" })),
    /CHALLENGE_MODEL must be a non-empty model identifier without whitespace/u,
  );
  assert.equal(configuration.thinking, "medium");
  assert.deepEqual(supportedThinkingLevels("berget", "Qwen/Qwen3.8-27B-FP8"), [
    "off",
    "low",
    "medium",
    "xhigh",
  ]);
  for (const unsupported of ["minimal", "high", "max"]) {
    assert.throws(
      () => readRuntimeConfiguration(bergetEnvironment({ CHALLENGE_THINKING: unsupported })),
      new RegExp(`CHALLENGE_THINKING=${unsupported} is not supported.*supported: off, low, medium, xhigh`, "u"),
    );
  }
  assert.throws(
    () => readRuntimeConfiguration({
      CHALLENGE_PROVIDER: "compatible",
      CHALLENGE_MODEL: "vendor/unknown",
      CHALLENGE_THINKING: "low",
    }),
    /supported: off/u,
  );
  assert.throws(
    () => readRuntimeConfiguration(bergetEnvironment({ BERGET_API_URL: "file:///tmp/api" })),
    /BERGET_API_URL must be a valid HTTP\(S\) URL/u,
  );
  assert.throws(
    () => readRuntimeConfiguration(bergetEnvironment({ BERGET_API_URL: "https://user:pass@example.test" })),
    /BERGET_API_URL must be a valid HTTP\(S\) URL/u,
  );
  const prepareConfiguration = readRuntimeConfiguration(
    bergetEnvironment({ BERGET_API_KEY: undefined }),
    { requireCredential: false },
  );
  assert.equal(prepareConfiguration.berget.credentialPresent, false);
  assert.equal(JSON.stringify(runtimeConfigurationMetadata(configuration)).includes("sentinel"), false);
});

test("installed Berget 0.3.2 Qwen mapping and Pi clamp preserve medium model-free", async () => {
  const providerSource = await readFile(
    join(process.cwd(), "node_modules", "@bergetai", "pi-provider", "index.ts"),
    "utf8",
  );
  const qwenOverride = providerSource.match(
    /'Qwen\/Qwen3\.8-27B-FP8':\s*\{(?<body>[\s\S]*?)\n\s*\},\n\s*'zai-org\/GLM-4\.7-FP8'/u,
  )?.groups?.body;
  assert.ok(qwenOverride, "installed provider source must contain the exact Qwen override");
  assert.match(providerSource, /const DEFAULT_MAX_TOKENS = 32_768/u);
  assert.match(providerSource, /input:\s*model\.inputPricePerToken \* 1e6/u);
  assert.match(providerSource, /output:\s*model\.outputPricePerToken \* 1e6/u);
  assert.match(providerSource, /cacheRead:\s*0/u);
  assert.match(providerSource, /cacheWrite:\s*0/u);
  assert.match(qwenOverride, /reasoning:\s*true/u);
  for (const mapping of ["low: 'low'", "medium: 'medium'", "off: 'none'", "xhigh: 'xhigh'"]) {
    assert.equal(qwenOverride.includes(mapping), true, `missing Qwen mapping ${mapping}`);
  }
  for (const unsupported of ["high: null", "max: null", "minimal: null"]) {
    assert.equal(qwenOverride.includes(unsupported), true, `missing Qwen clamp hole ${unsupported}`);
  }
  const model = {
    api: "openai-completions",
    baseUrl: "https://model-free.invalid/v1",
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: true },
    contextWindow: 131_072,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    id: "Qwen/Qwen3.8-27B-FP8",
    input: ["text", "image"],
    maxTokens: 32_768,
    name: "Qwen/Qwen3.8-27B-FP8",
    provider: "berget",
    reasoning: true,
    thinkingLevelMap: {
      high: null,
      low: "low",
      max: null,
      medium: "medium",
      minimal: null,
      off: "none",
      xhigh: "xhigh",
    },
  };
  assert.equal(model.reasoning, true);
  assert.equal(model.maxTokens, 32_768);
  assert.deepEqual(getSupportedThinkingLevels(model), ["off", "low", "medium", "xhigh"]);
  assert.equal(clampThinkingLevel(model, "medium"), "medium");

  let serializedPayload;
  let fetchCalls = 0;
  const stream = streamOpenAICompletions(
    model,
    {
      systemPrompt: "Model-free serialization fixture",
      messages: [{ role: "user", content: "hello", timestamp: 0 }],
      tools: [],
    },
    {
      apiKey: "model-free-placeholder",
      reasoningEffort: clampThinkingLevel(model, "medium"),
      maxRetries: 0,
      onPayload(payload) {
        serializedPayload = structuredClone(payload);
      },
      async fetch() {
        fetchCalls += 1;
        const event = {
          id: "fixture",
          object: "chat.completion.chunk",
          created: 0,
          model: "Qwen/Qwen3.8-27B-FP8",
          choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        };
        return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    },
  );
  for await (const _event of stream) {
    // Drain the synthetic stream so serialization completes without network.
  }
  assert.equal(fetchCalls, 1);
  assert.equal(serializedPayload.reasoning_effort, "medium");
  assert.equal(JSON.stringify(serializedPayload).includes("model-free-placeholder"), false);
});

test("normal Pi invocation is a safe exact argv with conditional Berget loading and no credential", () => {
  assert.match(resolvePiCli(), /@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]cli\.js$/u);
  assert.match(resolveBergetExtension(), /@bergetai[\\/]pi-provider[\\/]index\.ts$/u);
  const invocation = buildPiInvocation(readRuntimeConfiguration(bergetEnvironment()), {
    cwd: "/tmp/challenge",
    sessionDir: "/tmp/challenge/session",
    prompt: "Build the requested app",
    piCli: "/tmp/pi-cli.js",
    bergetExtension: "/tmp/berget/index.ts",
    runtimeGuardExtension: "/tmp/runtime-guard.js",
  });
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.shell, false);
  assert.equal(invocation.detached, true);
  assert.deepEqual(invocation.args, [
    "/tmp/pi-cli.js",
    "--mode",
    "json",
    "--print",
    "--provider",
    "berget",
    "--model",
    "berget/Qwen/Qwen3.8-27B-FP8",
    "--thinking",
    "medium",
    "--session-dir",
    "/tmp/challenge/session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-approve",
    "--extension",
    "/tmp/berget/index.ts",
    "--extension",
    "/tmp/runtime-guard.js",
    "Build the requested app",
  ]);
  assert.equal(JSON.stringify(invocationMetadata(invocation)).includes("gate-a-sentinel"), false);

  const otherProvider = readRuntimeConfiguration({
    CHALLENGE_PROVIDER: "compatible",
    CHALLENGE_MODEL: "vendor/model",
    CHALLENGE_THINKING: "off",
  });
  const otherInvocation = buildPiInvocation(otherProvider, {
    cwd: "/tmp/challenge",
    sessionDir: "/tmp/challenge/session",
    prompt: "Use another compatible provider",
    piCli: "/tmp/pi-cli.js",
  });
  assert.equal(otherInvocation.extension, null);
  assert.equal(otherInvocation.args.includes("--extension"), true);
  assert.match(otherInvocation.runtimeGuardExtension, /runtime-guard-extension\.js$/u);
});

test("normal challenge prompt fixes the runnable app contract while preserving the product brief", () => {
  const prompt = buildChallengePrompt("Track equipment loans with durable persistence.\n");
  assert.match(prompt, /npm test/u);
  assert.match(prompt, /npm run build/u);
  assert.match(prompt, /127\.0\.0\.1 --port 3000/u);
  assert.match(prompt, /Track equipment loans with durable persistence\./u);
});

test("normal provider guard fixes model, request, output, and projected-cost bounds", () => {
  const decision = executionGuardDecision(
    { messages: [{ role: "user", content: "build" }], max_tokens: 4_096 },
    qualificationModel({ input: 1, output: 2 }),
    { expectedModel: EXPECTED_QUALIFICATION_MODEL },
  );
  assert.equal(decision.accepted, true);
  assert.equal(decision.maxProviderRequests, DEFAULT_EXECUTION_GUARDS.maxProviderRequests);
  assert.equal(decision.maxOutputTokens, DEFAULT_EXECUTION_GUARDS.maxOutputTokens);
  assert.equal(decision.projectedTotalCostEur < 2, true);
  assert.equal(
    executionGuardDecision({}, qualificationModel({}, { id: "unexpected/model" }), {
      expectedModel: EXPECTED_QUALIFICATION_MODEL,
    }).reason,
    "selected-model-unexpected",
  );
  assert.equal(
    executionGuardDecision({}, qualificationModel({ input: undefined }), {
      expectedModel: EXPECTED_QUALIFICATION_MODEL,
    }).reason,
    "pricing-metadata-missing",
  );
});

test("Pi environment is minimal and the normal bash override cannot expose runtime controls or credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentcofounder-runtime-guard-"));
  const configuration = readRuntimeConfiguration(bergetEnvironment());
  const runtimeState = {
    agentDir: join(root, "pi-agent"),
    sessionDir: join(root, "pi-agent", "sessions"),
    homeDir: join(root, "home"),
    xdgConfigDir: join(root, "xdg-config"),
    xdgCacheDir: join(root, "xdg-cache"),
    xdgDataDir: join(root, "xdg-data"),
    xdgStateDir: join(root, "xdg-state"),
  };
  const sourceEnvironment = {
    ...bergetEnvironment(),
    PATH: process.env.PATH,
    HOME: "/ambient/home-sentinel",
    XDG_CONFIG_HOME: "/ambient/xdg-config-sentinel",
    PI_CODING_AGENT_DIR: "/ambient/pi-sentinel",
    UNRELATED_PARENT_SENTINEL: "must-not-enter-pi",
    OPENAI_API_KEY: "must-not-enter-pi",
    AGENTCOFOUNDER_TEST_PI_SPAWN_SENTINEL: join(root, "spawn.txt"),
    QUALIFICATION_NONCE: "a".repeat(48),
    QUALIFICATION_ARTIFACT: join(root, "nonce.txt"),
    QUALIFICATION_RUNTIME_OBSERVATION: join(root, "observation.jsonl"),
  };
  const piEnvironment = buildPiEnvironment(sourceEnvironment, configuration, runtimeState);
  assert.equal(piEnvironment.BERGET_API_KEY, "gate-a-sentinel-credential");
  assert.equal(piEnvironment.UNRELATED_PARENT_SENTINEL, undefined);
  assert.equal(piEnvironment.OPENAI_API_KEY, undefined);
  assert.equal(piEnvironment.AGENTCOFOUNDER_TEST_PI_SPAWN_SENTINEL, join(root, "spawn.txt"));
  assert.equal(piEnvironment.HOME, runtimeState.homeDir);
  assert.equal(piEnvironment.XDG_CONFIG_HOME, runtimeState.xdgConfigDir);
  assert.equal(piEnvironment.XDG_CACHE_HOME, runtimeState.xdgCacheDir);
  assert.equal(piEnvironment.XDG_DATA_HOME, runtimeState.xdgDataDir);
  assert.equal(piEnvironment.PI_CODING_AGENT_DIR, runtimeState.agentDir);
  assert.equal(piEnvironment.HOME.includes("ambient"), false);
  for (const name of [
    "QUALIFICATION_NONCE",
    "QUALIFICATION_ARTIFACT",
    "QUALIFICATION_RUNTIME_OBSERVATION",
  ]) {
    assert.equal(piEnvironment[name], undefined);
  }

  const qualificationEnvironment = buildPiEnvironment(
    sourceEnvironment,
    configuration,
    runtimeState,
    { qualification: true },
  );
  assert.equal(qualificationEnvironment.QUALIFICATION_NONCE, "a".repeat(48));
  assert.equal(qualificationEnvironment.QUALIFICATION_ARTIFACT, join(root, "nonce.txt"));
  assert.equal(
    qualificationEnvironment.QUALIFICATION_RUNTIME_OBSERVATION,
    join(root, "observation.jsonl"),
  );
  assert.throws(
    () => validateQualificationEnvironment({
      ...sourceEnvironment,
      QUALIFICATION_NONCE: undefined,
    }),
    /QUALIFICATION_NONCE is required/u,
  );
  assert.throws(
    () => validateQualificationEnvironment({
      ...sourceEnvironment,
      QUALIFICATION_ARTIFACT: "relative.txt",
    }),
    /QUALIFICATION_ARTIFACT must be an absolute path/u,
  );

  const qualificationSynthetic = await runPiInvocation({
    command: process.execPath,
    args: ["-e", [
      "const names=['QUALIFICATION_NONCE','QUALIFICATION_ARTIFACT','QUALIFICATION_RUNTIME_OBSERVATION'];",
      "process.stdout.write(JSON.stringify(Object.fromEntries(names.map((name)=>[name,process.env[name]??null]))));",
    ].join("")],
    cwd: root,
    shell: false,
    detached: true,
  }, {
    environment: { ...qualificationEnvironment, AGENTCOFOUNDER_TEST_PI_SPAWN_SENTINEL: undefined },
    timeoutMs: 1_000,
  });
  assert.deepEqual(JSON.parse(qualificationSynthetic.stdout), {
    QUALIFICATION_NONCE: "a".repeat(48),
    QUALIFICATION_ARTIFACT: join(root, "nonce.txt"),
    QUALIFICATION_RUNTIME_OBSERVATION: join(root, "observation.jsonl"),
  });

  const synthetic = await runPiInvocation({
    command: process.execPath,
    args: ["-e", [
      "const os=require('node:os');",
      "process.stdout.write(JSON.stringify({home:process.env.HOME,homedir:os.homedir(),xdg:process.env.XDG_CONFIG_HOME,ambient:process.env.UNRELATED_PARENT_SENTINEL??null}));",
    ].join("")],
    cwd: root,
    shell: false,
    detached: true,
  }, {
    environment: { ...piEnvironment, AGENTCOFOUNDER_TEST_PI_SPAWN_SENTINEL: undefined },
    timeoutMs: 1_000,
  });
  assert.deepEqual(JSON.parse(synthetic.stdout), {
    home: runtimeState.homeDir,
    homedir: runtimeState.homeDir,
    xdg: runtimeState.xdgConfigDir,
    ambient: null,
  });

  const guarded = guardBashEnvironment({
    ...piEnvironment,
    CHALLENGE_PROVIDER: "berget",
    OTHER_PROVIDER_API_KEY: "other-sentinel",
    SAFE_VALUE: "safe",
  });
  assert.equal(guarded.BERGET_API_KEY, undefined);
  assert.equal(guarded.CHALLENGE_PROVIDER, undefined);
  assert.equal(guarded.OTHER_PROVIDER_API_KEY, undefined);
  assert.equal(guarded.AGENTCOFOUNDER_TEST_PI_SPAWN_SENTINEL, undefined);
  assert.equal(guarded.SAFE_VALUE, "safe");

  const names = [
    "BERGET_API_KEY",
    "BERGET_API_URL",
    "CHALLENGE_PROVIDER",
    "CHALLENGE_MODEL",
    "CHALLENGE_THINKING",
    "QUALIFICATION_NONCE",
    "QUALIFICATION_ARTIFACT",
    "QUALIFICATION_RUNTIME_OBSERVATION",
    "AGENTCOFOUNDER_ISOLATION_ROOT",
  ];
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, bergetEnvironment({
    BERGET_API_URL: "https://example.invalid",
    QUALIFICATION_NONCE: "a".repeat(48),
    QUALIFICATION_ARTIFACT: join(root, "nonce.txt"),
    QUALIFICATION_RUNTIME_OBSERVATION: join(root, "observation.jsonl"),
    AGENTCOFOUNDER_ISOLATION_ROOT: root,
  }));
  try {
    let bashTool;
    runtimeGuardExtension({
      on() {},
      registerTool(tool) { bashTool = tool; },
    });
    const artifact = join(root, "bash-env.json");
    const script = [
      "const fs=require('node:fs');",
      `const names=${JSON.stringify(names)};`,
      "fs.writeFileSync(process.argv[1], JSON.stringify(Object.fromEntries(names.map((name)=>[name,process.env[name]??null]))));",
      "console.log(JSON.stringify(Object.fromEntries(names.map((name)=>[name,process.env[name]??null]))));",
    ].join("");
    const result = await bashTool.execute(
      "guard-test",
      { command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)} ${JSON.stringify(artifact)}` },
      undefined,
      undefined,
    );
    const retained = `${JSON.stringify(result)}\n${await readFile(artifact, "utf8")}`;
    assert.equal(retained.includes("gate-a-sentinel-credential"), false);
    assert.equal(retained.includes("Qwen/Qwen3.8-27B-FP8"), false);
    assert.deepEqual(JSON.parse(await readFile(artifact, "utf8")), Object.fromEntries(
      names.map((name) => [name, null]),
    ));
  } finally {
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("direct and evaluator-driven runtime paths ignore ambient HOME and global Pi state", () => {
  const direct = resolveRuntimeStatePaths("/tmp/workspace", {
    HOME: "/ambient/home",
    XDG_CONFIG_HOME: "/ambient/config",
    PI_CODING_AGENT_DIR: "/ambient/pi",
  });
  assert.equal(direct.runtimeRoot, "/tmp/workspace/.pi-runtime");
  assert.equal(direct.homeDir, "/tmp/workspace/.pi-runtime/home");
  assert.equal(direct.agentDir, "/tmp/workspace/.pi-runtime/pi-agent");
  assert.equal(JSON.stringify(direct).includes("ambient"), false);

  const evaluator = resolveRuntimeStatePaths("/tmp/frozen-workspace", {
    HOME: "/ambient/home",
    AGENTCOFOUNDER_ISOLATION_ROOT: "/tmp/evaluator-owned-state",
  });
  assert.equal(evaluator.homeDir, "/tmp/evaluator-owned-state/home");
  assert.equal(evaluator.sessionDir, "/tmp/evaluator-owned-state/pi-agent/sessions");
  assert.equal(JSON.stringify(evaluator).includes("ambient"), false);
});

test("qualification invocation uses the same seam with only the two fixture tools", () => {
  const invocation = buildPiInvocation(readRuntimeConfiguration(bergetEnvironment()), {
    cwd: "/tmp/challenge",
    sessionDir: "/tmp/challenge/session",
    prompt: "Run the bounded protocol",
    piCli: "/tmp/pi-cli.js",
    bergetExtension: "/tmp/berget/index.ts",
    qualification: true,
    qualificationExtension: "/tmp/qualification.ts",
  });
  assert.deepEqual(invocation.tools, [...QUALIFICATION_TOOL_NAMES]);
  assert.deepEqual(invocation.args.slice(-6), [
    "--extension",
    "/tmp/qualification.ts",
    "--no-builtin-tools",
    "--tools",
    "reveal_qualification_nonce,persist_qualification_nonce",
    "Run the bounded protocol",
  ]);
  assert.equal(invocation.args.includes("--no-extensions"), true);
  assert.equal(invocation.args.includes("gate-a-sentinel-credential"), false);
});

test("prepare-only runs before invalid runtime configuration and creates no Pi state or evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentcofounder-harness-prepare-"));
  const idea = join(directory, "idea.txt");
  const workspace = join(directory, "output", "app");
  await writeFile(idea, "A tiny test idea\n");
  const result = await execFileAsync(process.execPath, [
    "challenge.js",
    "--prepare-only",
    "--idea-file",
    idea,
  ], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      CHALLENGE_PROVIDER: "INVALID PROVIDER",
      CHALLENGE_THINKING: "invalid",
      CHALLENGE_WORKSPACE: workspace,
      BERGET_API_KEY: "gate-a-sentinel-credential",
    },
  });
  assert.match(result.stdout, /"status":"prepared"/u);
  await stat(workspace);
  await assert.rejects(stat(join(workspace, ".pi-runtime")));
  await assert.rejects(stat(join(workspace, "evidence")));
});

test("missing credential fails before workspace reset or Pi construction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentcofounder-harness-missing-key-"));
  const idea = join(directory, "idea.txt");
  const workspace = join(directory, "output", "app");
  const marker = join(workspace, "must-survive.txt");
  await mkdir(workspace, { recursive: true });
  await writeFile(marker, "preserved\n");
  await writeFile(idea, "A tiny test idea\n");
  await assert.rejects(
    execFileAsync(process.execPath, ["challenge.js", "--idea-file", idea], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        CHALLENGE_PROVIDER: "berget",
        CHALLENGE_MODEL: "Qwen/Qwen3.8-27B-FP8",
        CHALLENGE_THINKING: "medium",
        CHALLENGE_WORKSPACE: workspace,
      },
    }),
    (error) => {
      assert.match(error.stderr, /BERGET_API_KEY is required when CHALLENGE_PROVIDER=berget/u);
      assert.equal(error.stderr.includes("sentinel"), false);
      return true;
    },
  );
  assert.equal(await readFile(marker, "utf8"), "preserved\n");
});

test("dedicated Pi state disables retry and compaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentcofounder-harness-state-"));
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  const state = {
    agentDir,
    sessionDir,
    homeDir: join(root, "home"),
    xdgConfigDir: join(root, "xdg-config"),
    xdgCacheDir: join(root, "xdg-cache"),
    xdgDataDir: join(root, "xdg-data"),
    xdgStateDir: join(root, "xdg-state"),
  };
  await preparePiRuntimeState(state);
  const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
  assert.equal(settings.retry.enabled, false);
  assert.equal(settings.retry.maxRetries, 0);
  assert.equal(settings.retry.provider.maxRetries, 0);
  assert.equal(settings.compaction.enabled, false);
  await stat(sessionDir);
  await stat(state.homeDir);
  await stat(state.xdgConfigDir);
  await stat(state.xdgCacheDir);
  await stat(state.xdgDataDir);
});

test("synthetic runner bounds output and kills a real detached process tree without retry", async () => {
  const script = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`], { stdio: 'ignore' });",
    "console.log(child.pid);",
    "process.on('SIGTERM', () => {});",
    "setInterval(() => process.stdout.write('x'.repeat(200)), 5);",
  ].join("\n");
  const invocation = {
    command: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    shell: false,
    detached: true,
  };
  const result = await runPiInvocation(invocation, {
    timeoutMs: 80,
    killGraceMs: 60,
    outputLimitBytes: 512,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.termSent, true);
  assert.equal(result.killSent, true);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(Buffer.byteLength(result.stdout, "utf8") <= 512, true);
  const descendantPid = Number(result.stdout.split(/\r?\n/u)[0]);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  assert.throws(() => process.kill(descendantPid, 0), /ESRCH/u);
});

test("successful Pi parent exit still removes surviving detached-group descendants", async () => {
  const script = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`], { stdio: 'ignore' });",
    "child.unref();",
    "process.stdout.write(String(child.pid));",
  ].join("\n");
  const result = await runPiInvocation({
    command: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    shell: false,
    detached: true,
  }, {
    timeoutMs: 2_000,
    killGraceMs: 60,
  });
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.termSent, true);
  const descendantPid = Number(result.stdout);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  assert.throws(() => process.kill(descendantPid, 0), /ESRCH/u);
});

test("the test-only Pi-spawn sentinel is written only at the actual synthetic spawn boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentcofounder-pi-spawn-sentinel-"));
  const sentinel = join(root, "observed", "pi-spawn.txt");
  const result = await runPiInvocation({
    command: process.execPath,
    args: ["-e", "process.stdout.write('synthetic-no-network')"],
    cwd: root,
    shell: false,
    detached: true,
  }, {
    environment: {
      PATH: process.env.PATH,
      AGENTCOFOUNDER_TEST_PI_SPAWN_SENTINEL: sentinel,
    },
    timeoutMs: 1_000,
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "synthetic-no-network");
  assert.equal(await readFile(sentinel, "utf8"), "pi-spawn-observed\n");
});

test("qualification fixture enforces reveal then nonce-bearing persist and terminates", async () => {
  const handlers = new Map();
  const tools = new Map();
  qualificationNonceExtension({
    on(name, handler) { handlers.set(name, handler); },
    registerTool(tool) { tools.set(tool.name, tool); },
  });
  assert.deepEqual([...tools.keys()], [...QUALIFICATION_TOOL_NAMES]);
  const root = await mkdtemp(join(tmpdir(), "agentcofounder-qualification-fixture-"));
  const artifact = join(root, "nonce.txt");
  const observation = join(root, "runtime-observation.jsonl");
  const priorNonce = process.env.QUALIFICATION_NONCE;
  const priorArtifact = process.env.QUALIFICATION_ARTIFACT;
  const priorObservation = process.env.QUALIFICATION_RUNTIME_OBSERVATION;
  const priorThinking = process.env.CHALLENGE_THINKING;
  process.env.QUALIFICATION_NONCE = "a".repeat(48);
  process.env.QUALIFICATION_ARTIFACT = artifact;
  process.env.QUALIFICATION_RUNTIME_OBSERVATION = observation;
  process.env.CHALLENGE_THINKING = "medium";
  try {
    let aborted = false;
    const context = {
      thinkingLevel: "medium",
      model: qualificationModel(),
      abort() { aborted = true; },
    };
    const firstPayload = await handlers.get("before_provider_request")(
      { payload: { reasoning_effort: "medium" } },
      context,
    );
    assert.equal(firstPayload.max_tokens, MAX_QUALIFICATION_OUTPUT_TOKENS);
    const reveal = await tools.get("reveal_qualification_nonce").execute();
    assert.equal(reveal.content[0].text, "a".repeat(48));
    await handlers.get("before_provider_request")(
      { payload: { reasoning_effort: "medium" } },
      context,
    );
    const persist = await tools.get("persist_qualification_nonce").execute(
      "tool-2",
      { nonce: reveal.content[0].text },
    );
    assert.equal(persist.terminate, true);
    assert.equal(persist.details.exactMatch, true);
    assert.equal(await readFile(artifact, "utf8"), `${"a".repeat(48)}\n`);
    await handlers.get("before_provider_request")(
      { payload: { reasoning_effort: "medium" } },
      context,
    );
    assert.equal(aborted, true);
    const observations = (await readFile(observation, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(observations.length, 2);
    assert.equal(observations[0].type, "provider_request");
    assert.equal(observations[0].providerRequestIndex, 1);
    assert.equal(observations[0].requestedThinking, "medium");
    assert.equal(observations[0].piSelectedThinking, "medium");
    assert.equal(observations[0].serializedReasoningEffort, "medium");
    assert.equal(observations[0].providerConfirmedEffective, null);
    assert.equal(observations[0].maxOutputTokens, MAX_QUALIFICATION_OUTPUT_TOKENS);
    assert.deepEqual(observations[0].requestGuard, {
      accepted: true,
      reason: "accepted",
      requestBytes: Buffer.byteLength(JSON.stringify(firstPayload), "utf8"),
      requestByteLimit: MAX_QUALIFICATION_REQUEST_BYTES,
      rateBasis: "provider-0.3.2-pi-per-million-tokens",
      currencyAssumption: "EUR",
      providerConfirmedCurrency: null,
      inputRatePerMillion: 0.30,
      outputRatePerMillion: 2.50,
      cacheReadRatePerMillion: 0,
      cacheWriteRatePerMillion: 0,
      maxProviderResponses: MAX_QUALIFICATION_PROVIDER_RESPONSES,
      maxOutputTokensPerResponse: MAX_QUALIFICATION_OUTPUT_TOKENS,
      maxInputTokens: MAX_QUALIFICATION_REQUEST_BYTES * MAX_QUALIFICATION_PROVIDER_RESPONSES,
      maxOutputTokens: MAX_QUALIFICATION_OUTPUT_TOKENS * MAX_QUALIFICATION_PROVIDER_RESPONSES,
      projectedInputCostEur:
        MAX_QUALIFICATION_REQUEST_BYTES * MAX_QUALIFICATION_PROVIDER_RESPONSES * 0.30 / 1e6,
      projectedOutputCostEur:
        MAX_QUALIFICATION_OUTPUT_TOKENS * MAX_QUALIFICATION_PROVIDER_RESPONSES * 2.50 / 1e6,
      projectedTotalCostEur:
        (MAX_QUALIFICATION_REQUEST_BYTES * MAX_QUALIFICATION_PROVIDER_RESPONSES * 0.30 +
          MAX_QUALIFICATION_OUTPUT_TOKENS * MAX_QUALIFICATION_PROVIDER_RESPONSES * 2.50) / 1e6,
      selectedModelId: EXPECTED_QUALIFICATION_MODEL,
      expectedModelId: EXPECTED_QUALIFICATION_MODEL,
    });
  } finally {
    if (priorNonce === undefined) delete process.env.QUALIFICATION_NONCE;
    else process.env.QUALIFICATION_NONCE = priorNonce;
    if (priorArtifact === undefined) delete process.env.QUALIFICATION_ARTIFACT;
    else process.env.QUALIFICATION_ARTIFACT = priorArtifact;
    if (priorObservation === undefined) delete process.env.QUALIFICATION_RUNTIME_OBSERVATION;
    else process.env.QUALIFICATION_RUNTIME_OBSERVATION = priorObservation;
    if (priorThinking === undefined) delete process.env.CHALLENGE_THINKING;
    else process.env.CHALLENGE_THINKING = priorThinking;
  }
});

test("qualification cost metadata is optional and records a bounded projection", () => {
  for (const payload of [
    { messages: [{ role: "user", content: "bounded" }] },
    jsonPayloadWithExactBytes(MAX_QUALIFICATION_REQUEST_BYTES),
  ]) {
    const decision = qualificationRequestGuardDecision(
      payload,
      qualificationModel({ input: 1.00, output: 2.00 }),
    );
    assert.equal(decision.accepted, true);
    assert.equal(decision.requestBytes <= MAX_QUALIFICATION_REQUEST_BYTES, true);
    assert.equal(decision.providerConfirmedCurrency, null);
    assert.equal(decision.maxProviderResponses, MAX_QUALIFICATION_PROVIDER_RESPONSES);
    assert.equal(decision.maxInputTokens, 131_072);
    assert.equal(decision.maxOutputTokens, 2_048);
    assert.equal(decision.projectedInputCostEur, 131_072 / 1e6);
    assert.equal(decision.projectedOutputCostEur, 2_048 * 2 / 1e6);
    assert.equal(decision.projectedTotalCostEur, 131_072 / 1e6 + 2_048 * 2 / 1e6);
  }
});

test("qualification cost metadata never aborts and invalid values are sanitized", async () => {
  const cases = [
    { name: "missing cost object", payload: {}, model: qualificationModel({}, { cost: undefined }) },
    { name: "zero output rate", payload: {}, model: qualificationModel({ output: 0 }) },
    { name: "high rates", payload: {}, model: qualificationModel({ input: 1, output: 58.0703125000001 }) },
    { name: "unexpected unit key", payload: {}, model: qualificationModel({ unit: "per-token" }) },
    { name: "nonzero cache rate", payload: {}, model: qualificationModel({ cacheRead: 0.01 }) },
    { name: "invalid cost value", payload: {}, model: qualificationModel({ output: Number.NaN }) },
    { name: "negative input rate", payload: {}, model: qualificationModel({ input: -1 }) },
    { name: "negative cache rate", payload: {}, model: qualificationModel({ cacheRead: -1 }) },
    { name: "nonfinite projected cost", payload: {}, model: qualificationModel({ input: Number.MAX_VALUE }) },
  ];

  for (const scenario of cases) {
    const handlers = new Map();
    qualificationNonceExtension({
      on(name, handler) { handlers.set(name, handler); },
      registerTool() {},
    });
    let aborted = false;
    const payload = await handlers.get("before_provider_request")(
      { payload: scenario.payload },
      {
        model: scenario.model,
        thinkingLevel: "medium",
        abort() { aborted = true; },
      },
    );
    assert.equal(aborted, false, scenario.name);
    assert.equal(payload.max_tokens, MAX_QUALIFICATION_OUTPUT_TOKENS, scenario.name);
  }
});

test("qualification request and model guards still abort before synthetic provider invocation", async () => {
  const cases = [
    {
      name: "oversize request",
      payload: jsonPayloadWithExactBytes(MAX_QUALIFICATION_REQUEST_BYTES + 1),
      model: qualificationModel(),
      reason: "request-byte-limit-exceeded",
    },
    {
      name: "wrong model id",
      payload: {},
      model: qualificationModel({}, { id: "Qwen/Other" }),
      reason: "selected-model-id-unexpected",
    },
  ];

  for (const scenario of cases) {
    const handlers = new Map();
    qualificationNonceExtension({
      on(name, handler) { handlers.set(name, handler); },
      registerTool() {},
    });
    let aborted = false;
    let syntheticProviderInvocations = 0;
    let rejection;
    try {
      await handlers.get("before_provider_request")(
        { payload: scenario.payload },
        {
          model: scenario.model,
          thinkingLevel: "medium",
          abort() { aborted = true; },
        },
      );
    } catch (error) {
      rejection = error;
    }
    assert.match(rejection?.message ?? "", new RegExp(scenario.reason, "u"), scenario.name);
    // Pi's extension runner reports handler errors and continues dispatching;
    // the already-aborted context is what prevents the provider step.
    if (!aborted) syntheticProviderInvocations += 1;
    assert.equal(aborted, true, scenario.name);
    assert.equal(syntheticProviderInvocations, 0, scenario.name);
  }
});

test("synthetic evidence redacts credentials from every retained text file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentcofounder-evidence-test-"));
  const configuration = readRuntimeConfiguration(bergetEnvironment());
  const secret = "gate-a-sentinel-credential";
  await writeRuntimeEvidence(directory, {
    configuration,
    invocation: { arguments: ["--model", "berget/Qwen/Qwen3.8-27B-FP8"] },
    result: {
      code: 0,
      signal: null,
      timedOut: false,
      termSent: false,
      killSent: false,
      startedAt: "2026-08-23T00:00:00.000Z",
      endedAt: "2026-08-23T00:00:01.000Z",
      durationMs: 1000,
      stdout: `{"type":"message","text":"ok"}\nBERGET_API_KEY=${secret}\n`,
      stderr: `Authorization: Bearer ${secret}\n`,
    },
    secrets: [secret],
  });
  for (const name of await readdir(directory)) {
    const text = await readFile(join(directory, name), "utf8");
    assert.equal(text.includes(secret), false, `${name} retained the sentinel credential`);
  }
  assert.equal(redactText(`BERGET_API_KEY=${secret}`, [secret]).includes(secret), false);
  assert.deepEqual(redactValue({
    apiKey: secret,
    authorization: `Bearer ${secret}`,
    totalTokens: 23,
    reasoningTokens: 7,
    cacheReadTokens: 3,
    cacheWriteTokens: 2,
    cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
  }, [secret]), {
    apiKey: "[REDACTED]",
    authorization: "[REDACTED]",
    totalTokens: 23,
    reasoningTokens: 7,
    cacheReadTokens: 3,
    cacheWriteTokens: 2,
    cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
  });
});
