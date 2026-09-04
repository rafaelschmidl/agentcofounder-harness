# Final-push setup — 4 September 2026

Status: preparation authorized and performed; implementation plan and goal await Rafael's acceptance. This document describes the working setup, not an accepted architecture or promise of a top-three result.

## Starting point

Both local `main` branches matched GitHub `origin/main` on September 4 before preparation:

| Repository | MVP commit |
| --- | --- |
| Harness | `699db08132bb0116c3b54f482398704d8cff9974` |
| Evaluator | `70de1e05222909d245f8009d71c5c8de27271e37` |

Each repository now has a local `final-push/2026-09-04` branch and the local annotated tag `mvp-before-final-push-2026-09-04`. The two repositories remain independent. Keep the parent workspace unversioned. Preserve legacy branches/remotes and the retained MVP evidence.

The [organizer register and strategy assessment](assessment-2026-09-04.md) records sources and unresolved constraints. Latest applicable organizer Slack clarifications take precedence over older website text, within the scope of each reply. Speed is unscored; an unlimited generation timeout is not established. The old root `PLAN.md` is the historical August MVP plan, including its historical budget and branch instructions.

## Git and ownership

- Work locally on the final-push branches. Use one writer per file area; parallelize harness, independent evaluation, and release documentation when their edits do not overlap. Use a separate temporary worktree only for a conflicting or risky experiment.
- Make a local commit after each coherent, meaningfully verified milestone. Include its Linear identifier in the message. Avoid accumulating a day of uncommitted changes.
- A paid evaluation uses a resolved committed harness SHA from `git archive`, never the live working tree. Record the evaluator SHA alongside it. Commit local experimental candidates when they need evaluation; an experimental commit is not a release endorsement.
- Keep experiments local until their result is understood. Push useful, verified milestones for collaborator access or remote backup after the user has approved the concrete destination/ref/change range. Once a bounded push policy is approved, operate within it without asking repeatedly. No push policy has been accepted in this setup turn.
- Fetch remote state before any approved push or integration. Never force-push shared history. Preserve a collaborator's new changes and reconcile them explicitly. Promote a verified candidate to `main` through a normal integration only when authorized. Use a PR if it adds review value; do not require one for every local checkpoint.
- Public visibility, release destination, and form submission need a concrete reviewable package and the user's approval. Prepare that package after candidate selection in the reserved final delivery window. During development, retain run evidence and commit references as part of normal work. The evaluator may remain private. Repository visibility has not changed during setup.
- Keep credentials, dependency directories, generated working output, raw local evidence, and OS metadata out of commits. Publish only reviewed, curated evidence. Do not broadly stage the workspace.

## Linear

Use the existing Harness and Eval projects. Keep Linear as the compact record of ownership, status, acceptance evidence, and next decision; Git holds source truth and the evaluator retains detailed run evidence.

| Issue | Role |
| --- | --- |
| [AGE-21](https://linear.app/acf-hack/issue/AGE-21) | Authorized setup and execution handoff |
| [AGE-22](https://linear.app/acf-hack/issue/AGE-22) | Complete generation and truthful outcomes |
| [AGE-23](https://linear.app/acf-hack/issue/AGE-23) | Purposeful generated UX |
| [AGE-24](https://linear.app/acf-hack/issue/AGE-24) | Independent evidence, experiment accounting and runtime proof |
| [AGE-25](https://linear.app/acf-hack/issue/AGE-25) | Public release, reviewer handoff and confirmed submission |
| [AGE-26](https://linear.app/acf-hack/issue/AGE-26) | Optional declarative-generation spike, unselected |

Only active work is In Progress. AGE-22–25 start as Todo with an explicit plan-acceptance prerequisite. AGE-26 remains unassigned Backlog unless selected. Rafael owns the delivery issues; no work was assigned to another teammate. Update at start, meaningful milestone, blocker/decision, and completion. Link exact commits and concise evidence at completion; do not copy every tool log into Linear. Revise or cancel proposed issues if the accepted plan changes direction.

## Runtime and experiments

Use native macOS for the development loop with `mise exec node@22.19.0 -- …` and npm 10.9.3. Harness, app-template, evaluator dependencies and Playwright Chromium are installed. Port 3000 was free during setup.

Docker is not a prerequisite for starting the plan or daily experiments. At Rafael's request, container validation is deferred to the release candidate. Docker Desktop was started and reports Linux ARM64; that alone is not a packaging pass. Apple Silicon describes the CPU, while macOS/Linux dependency behavior can differ. The release should receive one focused compatibility proof against the organizer environment.

Rafael authorized the remaining Berget credit for development, validation and experimentation. The screenshot shows EUR 19.48 available. It is additional to historical spending, not a reset of history or permission to buy more credit.

- Canonical local campaign directory: `agentcofounder-eval/evidence/final-push-2026-09-04/`.
- Its cost ledger copies the historical 22 entries unchanged, totaling 1.922450 Pi-reported units; the working cumulative ceiling is 21.402450. Authorization metadata records the additional 19.48, historical count/total and source hash.
- Pi cost is an accounting proxy, not a verified currency conversion to Berget EUR. Actual available provider credit remains the spending boundary. Reconcile with provider usage before approaching the allowance and retain runway for final validation.
- One coordinator launches paid runs. Run them serially because the current evaluator shares port 3000 and has no cross-process budget lock. Verify the canonical existing ledger before every invocation; the current evaluator can otherwise create a fresh default ledger in a mistyped directory.
- Record each attempt and retain failures. If a call is interrupted or usage is missing from the ledger, reconcile its raw provider/Pi evidence before further paid work. The existing 0.50 projection is admission estimation, not a live per-run monetary cutoff. Persistent pending-run and locking improvements belong in AGE-24 if needed before unattended experimentation.
- Use the contest GLM-5.2 through Berget for final runtime evidence. Every runtime model call counts. Development experiments can explore alternatives, but they do not substitute for contest-model validation.
- Freeze a small development selection set and a separate final assessment set before generation. Keep expected outcomes outside harness inputs. Once a prompt informs a fix, it becomes development evidence. Compare functional fidelity, purposeful UX, completion/repair burden and all-attempt cost separately.

No paid model calls were made during this setup. Existing model settings and runtime code have not been changed.

## Transition to plan and goal

Next, use Plan mode to choose deliverables, experiment limits, acceptance criteria, a release cutoff, and an uninterrupted final validation/submission window. Keep a working candidate available throughout. The optional architecture spike must earn adoption with measured benefit and sufficient remaining time.

Rafael's latest sequencing decision: prioritize the working solution and its evidence; defer Docker compatibility validation and public release preparation until candidate selection. Reserve sufficient time to fix packaging and confirm submission. The earlier assessment's suggestion to prepare public materials alongside engineering is superseded by this decision.

Include an outcome-led goal in that plan: deliver and submit the strongest verified, organizer-compatible AgentCofounder candidate within the deadline and authorized credit, with reproducible evidence and an official receipt. Winning/top-three is the ambition; controllable delivery and submission criteria define completion. The goal should allow the agent to adapt tactics within the accepted boundaries.

Activate that goal only after Rafael accepts the plan. Do not mark it complete on an internal score or successful form click alone. No goal was activated during setup.
