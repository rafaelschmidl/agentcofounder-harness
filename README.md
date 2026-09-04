# AgentCofounder harness

Turn a raw startup idea into a local React application with retained requirements, generated source, verification results, and model-usage evidence. The harness interprets the idea into a validated ProductSpec, compiles a BuildPlan and shared runtime blocks, generates the product files, then verifies and repairs observed failures.

Generation uses **GLM-5.2 through Berget** by default. Pi is pinned to `@earendil-works/pi-coding-agent@0.84.1`; the Berget provider is pinned to `@bergetai/pi-provider@0.3.2`. Interpretation, generation, and repair run as separate Pi invocations with individual logs.

## Native setup

Use **Node.js 22.19.0 and npm 10.9.3**. Both package manifests require Node `>=22.19.0 <23`, and `.nvmrc` pins the development version. With mise, prefix npm commands with `mise exec node@22.19.0 --`.

From the repository root:

```bash
npm ci --ignore-scripts
npm --prefix app-template ci --ignore-scripts
npm run check
```

`npm run check` runs typechecking, harness tests, template tests, and the template build without paid model calls.

Provide `BERGET_API_KEY` in the shell environment or an untracked `.env.local`. The `challenge` script loads `.env.local` when present; it does not load `.env`. Leave optional provider/model variables unset to use the defaults below. Never commit credentials.

## Generate and run an app

```bash
npm run challenge
```

The default input is the public Book Lending idea in `contract-public/development-idea.txt`. Supply another idea without modifying the harness:

```bash
npm run challenge -- --idea-file /absolute/path/to/idea.txt
```

Each run resets the managed `output/app/` workspace. Use `--output-dir output/my-run` to select another directory beneath `output/`. A directory without the harness's ownership marker will not be reset.

To prepare the app and dependencies without invoking a model:

```bash
npm run challenge -- --prepare-only
```

After generation, from the repository root:

```bash
npm --prefix output/app run dev
```

The application serves at **http://localhost:3000**. The harness's temporary verification server is stopped before it returns. To run the app's tests and validate its report:

```bash
npm --prefix output/app test
npm run validate:result -- output/app/result.json
```

## Generation modes

The current candidate enables compiled collection semantics, with **high** interpreter thinking and **off** builder thinking. Supported flat collections get a compiler-owned domain while their React UI, CSS, and journey tests remain generated. Unsupported products use custom domain generation. This configuration is selected for fresh qualification; it is not yet a fully validated final result.

| Setting | Behavior |
| --- | --- |
| `CHALLENGE_EXECUTABLE_COLLECTION` | Defaults to `1`. The interpreter may choose a validated contract for one supported flat local collection. The compiler owns its domain implementation; the model generates its UI, CSS, and journey tests. Unsupported products retain explicit custom generation. Set `0` to disable this mode. |
| `CHALLENGE_COMPILED_UI_JOURNEYS=1` together with the collection flag | Opt-in; defaults off. For a compiled collection, the model supplies a typed interaction manifest alongside freely composed UI/CSS. The compiler emits immutable interaction tests; unsupported journey coverage remains visible. Custom products keep the ordinary generation path. |
| `CHALLENGE_SEMANTIC_REVIEW=1` | Optional source review after functional checks. Findings are repair hypotheses, not independent acceptance certification. Defaults off. |

The selected candidate's explicit equivalent of the default command is:

```bash
CHALLENGE_EXECUTABLE_COLLECTION=1 CHALLENGE_COMPILED_UI_JOURNEYS=0 CHALLENGE_INTERPRETER_THINKING=high CHALLENGE_BUILDER_THINKING=off npm run challenge -- --idea-file /absolute/path/to/idea.txt
```

Canonical requirements and explicit fallback reasons are retained as artifacts. Passing generated or compiled tests does not establish complete fidelity to the original idea; independent product journeys and visual review remain necessary.

## Runtime controls

| Variable | Current default |
| --- | --- |
| `CHALLENGE_PROVIDER` | `berget` |
| `CHALLENGE_MODEL` | `zai-org/GLM-5.2` |
| `CHALLENGE_INTERPRETER_THINKING` | `CHALLENGE_THINKING` when set, otherwise `high`; explicit `off` remains supported |
| `CHALLENGE_BUILDER_THINKING` | `off`, used for generation and repair independently of interpreter thinking |
| `CHALLENGE_MAX_OUTPUT_TOKENS` | `32768` per response, including reasoning; accepted range `1..32768` |
| `CHALLENGE_TIMEOUT_MS` | `5400000` milliseconds (90 minutes) for the run |

The harness allows up to 32 model responses and seven repair cycles, stopping earlier on success, exhausted limits, or an unchanged completed repair diagnosis. These are harness controls, not claims about organizer time limits or scoring weights.

```bash
npm run challenge -- --print-run-limits
npm run challenge -- --help
```

The limits command validates and prints the response envelope without preparing an app or invoking Pi. Native development can use `--verification-port 3111` for temporary verification; the delivered app URL and start command still target port 3000.

## Results and retained evidence

The runner owns both `report.partial.json` and the final `result.json`. Product claims are derived from observed journey verification; the model does not supply headline usage totals.

- `output/app/`: generated source, `idea_spec.json`, `build_plan.json`, `file_ownership.json`, `report.partial.json`, `result.json`, and `trace.jsonl`.
- Repository-root `result.json`: the same result with a start command appropriate to the repository root. The app-root result uses `npm run dev`.
- `artifacts/runs/<run-id>/`: source input, stage traces, raw Pi events and sessions, provider-request metadata, verification logs, repair evidence, and source checkpoints.
- `artifacts/run-limits.json`: resolved response limits. Compiled interaction mode also retains its manifest and `compiled-ui-coverage.json` in the generated app.

Reports include status, summary, implemented features, assumptions, journey tests, harness checks, token totals, Pi-reported cost, and a per-call usage log. Usage totals are assembled from retained Pi events across all stages; interrupted requests require reconciliation against raw request evidence, not an assumption of zero cost.

`success` requires completed passing journey evidence plus successful harness verification. Failed checks produce `partial` or `failed` and a nonzero process exit. If a repair breaks a previously buildable, startable app, the harness can restore its exact source checkpoint while retaining the regression and failed acceptance evidence. A restored app is not automatically successful.

## Runtime portability

Development and validation run natively on macOS. The pinned lockfiles include Linux ARM64 packages, and a Dockerfile is included, but the current candidate has not yet completed Linux ARM64 or restricted-network packaging validation.

The default challenge recreates app dependencies with `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund`. In a runtime that only permits provider traffic, those packages must already be available in its npm cache. The Dockerfile installs root/template dependencies and warms that cache at build time, then sets `npm_config_offline=true`. Its build must recreate and build the seed app with this offline setting before packaging. For an equivalent native smoke test, use `npm_config_offline=true npm run challenge -- --prepare-only` after installing the dependencies. Generated applications should use bundled assets and local interfaces rather than depend on runtime access to external fonts or services.

## Source map

- `src/product-spec/`: interpretation, provenance, validation, and retained draft repair.
- `src/build-plan/` and `src/executable-collection/`: compilation, shared runtime, ownership, and optional compiled domain/interaction tests.
- `solution/`: generation and repair prompts, Pi extensions, and offline product/design knowledge.
- `app-template/`: pinned React/Vite application seed.
- `contract-public/`: public input, journey guidance, and result schema. Evaluation ideas can be supplied externally through `--idea-file`.

Generated code and Pi extensions execute with the current process's permissions. File-ownership guards constrain the workflow; they are not an operating-system sandbox.
