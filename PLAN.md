# System v0 PoC-to-MVP Plan

Status: `APPROVED`

Approved: 2026-08-28

## Objective and acceptance gates

Build System v0 on the clean `system-v0` branches, evolving the official starter without importing the abandoned proof-of-concept architecture.

### PoC — Book Lending

- Run the raw Book Lending prompt through live GLM-5.2 interpretation, validated `ProductSpec`, deterministic `BuildPlan`, block materialization, GLM-5.2 product customization, deterministic linking, verification, and bounded repair.
- Produce a successful application from a committed harness SHA with valid results, telemetry, `idea_spec.json`, `build_plan.json`, and `trace.jsonl`.
- Pass independent Book Lending browser journeys against a clean snapshot of that SHA.

### MVP — three live domains

The same final harness SHA must succeed from raw prompts for:

1. Book Lending and local persistence.
2. Small commerce checkout with deterministic payment stub.
3. SaaS feedback workflow with state transitions and dashboard counts.

All three must pass independent browser journeys within EUR 5 of cumulative Berget provider spend. Reaching the budget before all three pass does not count as MVP completion.

## Implementation

### Freeze the independent reference corpus

Create evaluator-owned prompts, requirements, and journey identifiers before tuning the harness:

- **Book Lending:** create, edit, delete, lend, return, filter, lent count, refresh persistence, and category ambiguity.
- **Commerce:** manage products and stock; cart quantities and totals; customer checkout; successful and declined payments; correct stock/order effects; refresh persistence; no real payment or login.
- **SaaS workflow:** capture customer feedback with category and priority; enforce workflow transitions; filter by state/priority; show active and shipped counts; refresh persistence; no teams or authentication.

The manifests remain outside the harness and are never mounted into generation runs.

### Build a thin deterministic spine, then use the contest model immediately

- Segment the raw idea into stable source fragments with IDs and character offsets.
- Define `ProductSpec v0.1` as JSON Schema plus matching TypeScript types, validated with Ajv.
- Add an offline pattern index and cards for CRUD, local persistence, state workflows, transactions, checkout, derived metrics, commerce, and SaaS operations.
- Run an interpreter role through Pi with coding tools disabled. It can retrieve local pattern cards and submit a candidate ProductSpec.
- Return schema and coverage errors within the same bounded interpreter session.
- Make the first live Berget/GLM-5.2 action a real Book Lending interpretation, not a qualification gate.

### Compile ProductSpec into BuildPlan

Implement a deterministic resolver that selects versioned blocks, configuration, order, custom slots, ownership, and verification obligations.

Initial capability blocks:

- React/Vite application foundation.
- Versioned local-storage repository with malformed-data recovery.
- Record collection, CRUD, filtering, and derived metrics.
- Explicit state-machine workflow.
- Cart/order transaction and deterministic payment provider stub.
- Accessible application-shell and form primitives.
- Generated unit and journey-test primitives.

Every block declares its ID, version, configuration schema, capabilities, dependencies, conflicts, owned files, exported interfaces, materializer, and checks. Compilation fails when required behavior is neither supported by a block nor assigned to an explicit custom slot.

### Materialize, customize, and link

- Materialize deterministic infrastructure and typed extension interfaces first.
- Generate a file-ownership manifest distinguishing block-owned, agent-owned, and linker-owned files.
- Run a builder role only after those interfaces exist.
- Let the configured model own product-specific UI, language, visual composition, and exceptional domain logic within declared agent-owned paths.
- Prevent the model from editing block-owned or linker-owned files.
- Deterministically generate final exports, routes, manifests, entry points, dependencies, and verification wiring.
- Preserve React 19, Vite, and the committed application lockfile; generated apps may not install packages.

### Verify, diagnose, and repair

Run:

1. ProductSpec schema, source coverage, provenance, contradictions, and journey mapping.
2. BuildPlan resolution, block compatibility, traceability, and file ownership.
3. Generated-app type/static checks.
4. Product tests.
5. Production build.
6. Startup at `http://localhost:3000`.
7. Harness-owned browser smoke checks.
8. Result, telemetry, trace, and cleanup validation.

Repair routing:

- interpretation or coverage -> interpreter;
- planning or block selection -> resolver or configuration;
- custom interface, build, or runtime -> builder;
- journey failure -> responsible requirement, transition, block, or custom slot.

Allow at most seven diagnosed repair cycles per idea. Every retry must include a changed diagnosis and targeted failure evidence.

### Provider and execution boundary

Working development configuration:

- Provider: `berget`
- Model: `zai-org/GLM-5.2` (confirmed model family; slug verified in the installed Berget extension)
- Interpreter thinking: `off` for reliable compact structured submission
- Builder and repair thinking: `off` for direct tool execution, independently configurable
- Maximum 32 provider responses per app run
- Maximum 8,192 output tokens per response
- Maximum seven repair cycles
- 30-minute wall-clock limit per run
- EUR 5 cumulative budget across this push

Keep provider settings configurable and credentials environment-only. Isolate HOME, XDG, Pi state, sessions, and generated workspaces. Only allowlisted runtime variables reach Pi, and credentials and challenge controls are stripped from model-invoked shell processes.

Aggregate every Pi stage into one chronological runner-owned call log. The evaluator owns the cumulative cost ledger and refuses a request whose conservative projection would exceed the remaining budget.

## Contracts and artifacts

### ProductSpec v0.1

Include:

- version and source-idea hash;
- source fragments and complete fragment disposition;
- product summary, actors, goals, and constraints;
- requirements with `EXPLICIT`, `IMPLIED`, `DEFAULT`, `PROPOSED`, or `EXCLUDED` provenance;
- exact source references for explicit requirements;
- entities, fields, relationships, and validation;
- workflows, transitions, rules, and invariants;
- persistence and integration needs;
- views and important interface states;
- acceptance journeys and requirement mappings;
- assumptions, exclusions, conflicts, and selected patterns.

Every source fragment must be classified. Every implemented requirement must map to an acceptance journey.

### BuildPlan v0.1

Include:

- ProductSpec content hash;
- selected blocks, versions, configuration, and order;
- custom slots with required interfaces and permitted paths;
- complete file-ownership manifest;
- dependency, route, and export manifests;
- requirement-to-implementation mapping;
- generated verification obligations.

### Compatibility and outputs

Preserve:

```text
npm run challenge -- --idea-file <path>
```

Preserve both required `result.json` destinations and existing telemetry fields. Add `idea_spec.json`, `build_plan.json`, `trace.jsonl`, and `report.partial.json`. Mirror them with raw Pi events, sessions, logs, checks, and the source idea under retained run evidence.

`trace.jsonl` records provenance, decisions, stage transitions, diagnoses, repairs, and verification outcomes, not private chain-of-thought.

The evaluator command becomes:

```text
npm run evaluate -- --harness <repo> --ref <ref> --fixture <fixture-id> --evidence-dir <path>
```

## Evaluation and tests

### Harness tests

- ProductSpec and BuildPlan schema acceptance and rejection.
- Exact source-offset verification and complete source disposition.
- Provenance, negative evidence, and proposed-feature rules.
- Offline pattern retrieval and audit recording.
- Deterministic block resolution, conflicts, and stable output hashes.
- File-ownership enforcement and safe recompilation.
- Persistence corruption recovery and schema versioning.
- Allowed and invalid workflow transitions.
- Successful and declined payment-stub behavior.
- Repair classification, attempt limits, and changed-diagnosis enforcement.
- Multi-session usage aggregation, budget enforcement, redaction, timeout, and cleanup.
- Golden compilation tests for reviewed ProductSpecs from all three domains.

### Independent evaluator

- Resolve the harness ref to an exact commit SHA and evaluate a clean archive snapshot.
- Install only from committed lockfiles and invoke only the public challenge command.
- Retain generated source and evidence additively.
- Judge the app separately with explicit Playwright journeys, never tests inferred from the generated ProductSpec.
- Capture screenshots, console errors, journey evidence, result reconciliation, telemetry, and cost.
- Test mobile and desktop layouts.
- Fail on missing journeys, false success reports, telemetry disagreement, leaked credentials, leftover processes, or unexpected browser network requests.
- Run final evaluations against one identical harness SHA.

### Published readiness simulation

System v0 does not use LLM-as-judge. It reproduces the published readiness categories through explicit checks:

- **Usability and UX — 30:** task completion, accessible names and keyboard operation, validation/error feedback, responsive layout, empty states, and clean browser console.
- **Persistence — 20:** reload survival, correct mutation persistence, and malformed-data recovery.
- **Robustness — 20:** empty/invalid input, duplicate/repeated actions, boundaries, invalid transitions, and payment failure behavior.
- **Integration readiness — 15:** repository/provider interfaces and UI decoupling from concrete storage/payment implementations.
- **Maintainability — 15:** passing type/build/test gates, clear ownership and separation, and traceable journey coverage.

Points use named binary subchecks with attached evidence. Each MVP app must pass every qualification journey, score at least 85/100, and receive points in every category.

Calculate and retain the website's currently published efficiency formula:

```text
input tokens + output tokens x 3 + cache-read tokens x 0.1
```

Also retain Pi-reported monetary cost. Organizer Slack now says Pi cost is accepted and that the readiness/efficiency weighting is undecided, while the website still says qualifying entries rank strictly by weighted tokens. Treat this as unresolved official-source conflict: report both independently and do not invent a combined score. Report cache-write tokens separately because neither source currently supplies a weight. Participant-observed GLM cache reads are useful experimental evidence, not an organizer guarantee. Retain screenshots and evidence for human review. Add a model judge only if organizers confirm LLM-as-judge or later calibration demonstrates value.

## Git, Linear, and Goal workflow

### Git

- Continue only on `system-v0` in both repositories.
- Never merge or cherry-pick legacy PoC or integration branches.
- Reimplement only independently justified provider isolation, redaction, cleanup, and frozen-SHA ideas with fresh tests.
- Commit locally at verified milestone boundaries.
- Do not create a PR, modify `main`, or replace default branches during this Goal.
- Preview exact commits and destinations before a later push requiring approval.

### Linear

Keep the existing Harness and Eval projects and leave cancelled legacy issues untouched. Create six High-priority issues assigned to Rafael, initially in Backlog:

1. **Eval — Freeze the three-prompt System v0 reference corpus**
2. **Harness — Implement ProductSpec interpretation and offline pattern retrieval**
3. **Harness — Build the deterministic compiler and live Book Lending PoC**
4. **Harness — Add verification, diagnosed repair, and audited delivery**
5. **Harness — Generalize capability blocks across commerce and SaaS**
6. **Eval — Verify one final harness SHA across all three live prompts**

Link them sequentially. Only current work becomes In Progress. Return unfinished active work to Backlog when a working session ends.

### Goal

After `PLAN.md` and Linear setup are complete, start one Goal with this objective:

> Implement the approved System v0 `PLAN.md` across the clean harness and evaluator `system-v0` branches. Produce a verified Book Lending PoC, then a verified MVP where one final harness SHA runs Book Lending, commerce checkout, and SaaS workflow from raw prompts through Berget/GLM-5.2 and the shared compiler. Require all independent browser journeys to pass, each app to reach the internal 85/100 readiness target, and cumulative recorded provider cost to remain within EUR 5. Preserve official contracts, retain evidence, allow at most seven diagnosed repairs per idea, do not import legacy architecture, and do not modify main or push without the required approval.

## Locked decisions

- Harness starts at `1fc709b`; evaluator starts at `0f6caca`; the harness remains aligned with official starter revision `1363299`.
- The official starter remains authoritative for runtime and result compatibility.
- The published challenge specification motivates `idea_spec.json`, `trace.jsonl`, autonomous review and repair, readiness scoring, and weighted-token measurement.
- `CONFIRMED` by organizers: contest judgment is based on Berget's GLM-5.2; Qwen 3.8 27B is comparative only.
- `CONFIRMED` by organizers: the website Book Lending prompt is final, and the hidden prompt is different but similar in structure, difficulty, application kind, and scale.
- `CONFIRMED` by organizers: Pi-reported runtime cost may be used; organizers will reconcile provider discrepancies.
- `CONFLICT`: the website still says qualifying entries rank strictly by weighted tokens, while newer organizer statements say the readiness/efficiency balance is not finalized.
- `DECISION`: retain weighted tokens, cache-write tokens, Pi cost, and readiness separately; the 85/100 threshold remains an internal gate, not an official cutoff.
- `INFERENCE`: `zai-org/GLM-5.2` is the intended live slug because it appears in participant evidence and the installed Berget extension; exact official thinking/runtime settings remain pending.
- No confirmed official evidence establishes LLM-as-judge.
- General internet access is unavailable during generation; product knowledge is bundled locally.
- Berget/GLM-5.2 and comparative Qwen calls within the cumulative EUR 5 limit are approved without another provider-stage pause.
- Three live applications are required for MVP completion.
- Linear projects remain In Progress; no new project, cycle, milestone, or label structure is introduced.
