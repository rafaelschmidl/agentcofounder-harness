# Local Pi runtime configuration

The harness keeps Pi as its execution abstraction. Runtime selection is supplied by the environment at invocation time; it is not part of the idea-file protocol and no credential is accepted as a command-line argument.

```sh
export CHALLENGE_PROVIDER=berget
export CHALLENGE_MODEL=Qwen/Qwen3.8-27B-FP8
export CHALLENGE_THINKING=medium
export BERGET_API_KEY='<your-key>'
# Optional endpoint overrides:
# export BERGET_API_URL=https://api.berget.ai
# export BERGET_INFERENCE_URL=https://api.berget.ai/v1

mise exec node@22.19.0 -- npm ci --ignore-scripts
mise exec node@22.19.0 -- npm run challenge -- --idea-file /path/to/idea.txt
```

For a reusable local setup, keep one secret file outside both repositories and load it into the shared shell before either direct or evaluator-driven execution. Its location is only a local convenience; the runtime contract depends on the exported variables, not on a particular file path. You may seed that external file from this repository's placeholder-only `.env.example`:

```sh
cp /path/to/agentcofounder-harness/.env.example /absolute/path/outside/both/repos/.env.local
# Edit the external .env.local locally; never commit it.
AGENTCOFOUNDER_ENV_FILE=/absolute/path/outside/both/repos/.env.local
set -a
source "$AGENTCOFOUNDER_ENV_FILE"
set +a
```

The pinned runtime is Node `22.19.0`, npm `10.9.3`, `@earendil-works/pi-coding-agent@0.84.1`, direct `@earendil-works/pi-ai@0.84.1`, and `@bergetai/pi-provider@0.3.2`. Provider `0.3.2` declares the Qwen route as reasoning-capable with `off`, `low`, `medium`, and `xhigh`; the first experiment requests `medium`. The harness validates this exact capability map before spawning Pi, so `minimal`, `high`, and `max` fail rather than being silently clamped. Until a provider/model capability is explicitly established at this boundary, its conservative supported set is `off` only. This is validation policy, not a permanent Qwen default. Requested configuration, Pi-selected thinking, serialized `reasoning_effort`, and provider-confirmed effective behavior are separate evidence fields. The provider-confirmed field remains `null` unless a live response actually reports it.

`BERGET_API_KEY` remains in the shell environment only. Repository-local `.env` and `.env.*` files are ignored as a defensive backstop, while `.env.example` contains a placeholder only; the recommended real secret file remains outside both repositories. Never commit a key or copy it into a snapshot, result, event, session, log, or evidence file.

## Isolation and evidence

Each full challenge run resets `output/app`, starts Pi with dedicated `HOME`, XDG config/cache/data/state, Pi-agent, and session directories, disables ambient extension/skill/prompt/theme/context discovery, and loads the pinned Berget extension explicitly when `CHALLENGE_PROVIDER=berget`. Direct runs construct those paths below `output/app/.pi-runtime`; evaluator runs map the same layout below an evaluator-owned temporary isolation root. Ambient `HOME`, XDG, and global Pi paths are ignored. The Pi process is built from a small system allowlist plus the explicit runtime contract, so unrelated parent variables do not enter it. Pi receives the API key through this child environment and reads it through the extension's canonical `BERGET_API_KEY` variable. A provider-neutral runtime-guard extension replaces Pi's normal `bash` tool through Pi's supported `createBashTool` `spawnHook`; it strips provider credentials, endpoints, challenge controls, qualification controls, and all AgentCofounder controls from every model-invoked bash child. The same extension caps provider requests, response tokens, serialized request bytes, and projected cost, records sanitized request decisions, and validates the Pi-selected provider against the requested provider. An evaluator may additionally fix an exact expected model. The `provider-smoke` workflow instead disables all built-in tools and exposes only its two nonce tools.

Retry and compaction are disabled in the dedicated Pi settings. The test-only qualification profile validates and forwards its nonce/artifact/observation variables to Pi only for an explicitly selected `provider-smoke` run; normal challenge runs never forward them. Its built-in tools remain disabled and only the two nonce tools are exposed. The profile limits the session to two provider requests, caps each provider response at 1,024 output tokens (rather than the provider's 32,768-token default), and limits each final serialized request to 64 KiB. Immediately before inference it requires the selected Pi model id to be exactly `Qwen/Qwen3.8-27B-FP8` and records the selected model's provider-0.3.2 per-million cost metadata when it is finite and nonnegative. Price metadata is evidence-only: missing, malformed, different, or high prices do not abort the provider request. When finite input/output rates are available, the harness records the bounded estimate for at most `131,072` input tokens and `2,048` output tokens across the session; otherwise the affected rate and estimate fields are `null`. The observed `€1.00/M` input and `€2.00/M` output metadata projects to `€0.135168`. This exact-model guard belongs only to `provider-smoke`; normal execution remains provider-configurable. Only sanitized model/size/rate/projection decisions are recorded, with provider-confirmed billing remaining `null` until live evidence reports it. Any failed non-price guard aborts before the provider request; retained process output is bounded and the second tool terminates the successful qualification flow.

`npm run challenge -- --prepare-only --idea-file <path>` only resets/prepares `output/app`. It does not parse provider configuration or call the Pi spawn seam. The evaluator's `offline-preflight` workflow verifies the absence of Pi-spawn, session, runtime-state, harness-evidence, and instrumented Node network observations using test-only sentinels; those sentinels are not part of normal execution.

Full-run evidence is written below `output/app/evidence/` with redacted stdout, stderr, JSON events, requested runtime metadata, observed runtime metadata when available, exit/signal status, timing, and timeout state. Usage token and object-shaped Pi cost fields remain numeric evidence; credential-named fields and exact credential values are redacted. Missing configuration fails early with the variable name; secret values are never included in errors.

Switching to another Pi-compatible provider uses the same environment contract and invocation seam. Only Berget requires the conditional explicit extension and its endpoint/credential variables.
