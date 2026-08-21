# AgentCofounder submission contract

Last verified: 2026-08-21

Official starter revision verified: [`1363299`](https://github.com/stockholm-ai/agentcofounder/commit/1363299d065129b7992a025bd3946b3219217b4c)

This document records the external contract that this repository must satisfy to remain a valid AgentCofounder submission candidate. It does not define our harness architecture or strategy.

## Challenge and official sources

AgentCofounder is a Stockholm AI open-source hackathon to build an autonomous coding harness that turns a raw startup idea into a working, tested application.

- [Official challenge portal](https://luma.com/cjgfx089)
- [Official Stockholm AI starter repository](https://github.com/stockholm-ai/agentcofounder)
- [Starter contract and run instructions](https://github.com/stockholm-ai/agentcofounder/blob/main/README.md)
- [Public result schema](https://github.com/stockholm-ai/agentcofounder/blob/main/contract-public/result.schema.json)
- [Organizer checklist](https://github.com/stockholm-ai/agentcofounder/blob/main/docs/organizer-checklist.md)

The portal currently identifies the event and dates but marks full details and rules as coming soon. The starter repository is therefore the current official source for the technical contract below. Items are separated into confirmed requirements and pending organizer publication.

## Confirmed runtime and submission constraints

- Node.js is restricted to the `22.19.x` line. The official package engine is `>=22.19.0 <23`, and the reference container uses Node.js `22.19.0`.
- npm is pinned to `10.9.3`; committed lockfiles are part of the reproducible install contract.
- Pi is installed locally at exactly `@earendil-works/pi-coding-agent@0.84.1`. A floating installer or in-challenge Pi update is not permitted by the starter.
- The organizer freezes a participant commit SHA, installs with `npm ci --ignore-scripts` in an organizer-controlled runtime, and verifies the installed Pi version before a timed run.
- Hidden prompts, hidden browser tests, model credentials, and final scoring code remain outside the participant repository.
- The current official invocation is `npm run challenge`; organizer or hidden ideas are supplied with `--idea-file /path/to/idea.txt`.

## Expected organizer workflow

The current organizer checklist describes this sequence:

1. Record the submission commit SHA at the deadline.
2. Build the frozen commit in the controlled runtime with `npm ci --ignore-scripts` and verify Pi `0.84.1`.
3. Confirm the designated provider/model is available in Pi's offline model catalogue.
4. Run the complete success path against the finalized public prompt and audit the application, results, process cleanup, raw events, and telemetry reconciliation.
5. Run the unchanged commit against a hidden idea in a fresh isolated environment.
6. Judge the generated application externally and recompute usage from organizer-controlled evidence.

## Harness inputs

- A plain-text development idea is authoritative for the application to generate.
- The public idea is expected at the starter's default contract path; organizer testing may inject another idea through `--idea-file`.
- The organizer supplies provider/model selection and a short-lived credential through the judging environment.
- Public, domain-neutral journey guidance may clarify common behaviors, but it does not override the idea or make unrelated features mandatory.
- Hidden test sources are not mounted into the participant workspace.

## Required generated application behavior

- Generate the application in a fresh, disposable workspace and do not rely on residue from an earlier run.
- Implement every behavior that the input idea states or implies; omit unrelated substitute features and record decisions about ambiguity as assumptions.
- Start without errors at `http://localhost:3000` with port 3000 free on IPv4 and IPv6 loopback before verification.
- Satisfy the current runner's independent test, build, and startup checks. A successful result requires at least one completed passing product-journey test and no failed, skipped, or todo tests.
- Remain testable by browser journeys executed outside the harness process or container.

## Required result and telemetry behavior

- Emit schema-valid final results at both `output/app/result.json` and repository-root `result.json`. Their location-aware `start_command` values may differ; equivalent substantive results are required.
- Report status, application URL and start command, summary, implemented features, assumptions, product-journey tests, independent harness checks, Pi exit status, and port-reclamation evidence as defined by the public schema.
- Report model-call usage including input, output, cache-read, cache-write, total and reasoning tokens, provider cost, and a per-call log.
- Derive final telemetry from completed Pi JSON events rather than model-authored totals. Retain the raw JSON event stream and Pi session JSONL for audit.
- Treat organizer-recomputed Pi session and gateway telemetry as authoritative. A reconciliation failure is an audit failure.
- Exit non-zero if either required result destination cannot be written.

## Judging isolation

Official material requires a fresh isolated container or VM, a read-only harness/public-contract/schema mount, and write access limited to generated output, artifacts, and the required root result target. The judge runs browser tests separately, enforces wall-clock and process-tree termination externally, blocks instance metadata and internal networks, restricts unrelated outbound access, and preserves the runtime image digest, commit SHA, source, logs, sessions, results, and test evidence.

## Pending organizer publication or clarification

- Finalized public development prompt and the full public challenge rules.
- Exact judging runtime image digest beyond the currently published Node/npm/Pi versions.
- Designated provider and model identifier, final thinking level, and credential/gateway configuration.
- Exact timeout, CPU, memory, disk, and network limits.
- Cache-write token weighting.
- The single authoritative efficiency ranking method: custom weighted-token formula or Pi provider cost.
- Exact submission delivery mechanism beyond freezing a participant commit SHA.

Until these items are published, they must remain configurable or explicitly unresolved rather than being treated as submission facts.
