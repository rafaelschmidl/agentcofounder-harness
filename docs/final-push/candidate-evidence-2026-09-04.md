# Candidate evidence, 4 September 2026

## Current convergence candidate

Harness **`8fba03d468c1dfb3e4e4796b1e39f522af15ce2e`** is the selected source candidate for fresh qualification. Evaluator: **`f0c6bfea087d5dd1984133a396a6d18fb8d47e3d`**. The configuration below supersedes the earlier checkpoints in this document; their runs and failures remain historical evidence. It is not yet a freshly qualified final product generator.

Default runtime: GLM-5.2 through Berget, interpreter thinking **high**, builder/repair thinking **off**, `CHALLENGE_EXECUTABLE_COLLECTION=1`, and `CHALLENGE_COMPILED_UI_JOURNEYS=0`. Supported flat collections use compiled domain behavior with freely generated UI, CSS, and journey tests; unsupported requirements retain custom generation. The response ceiling is 32,768 tokens and the configurable run ceiling is 5,400,000 ms (90 minutes). This is an operational limit, not an assertion about organizer runtime limits. Explicit overrides remain supported.

A frozen native Node 22.19.0 checkout passed typechecking, **315/315 harness tests**, and the template production build. Full log: `/private/tmp/acf-8fba03d-full-check.log`. The template has no product tests; its successful build and the harness suite do not establish fresh generated-product quality.

Jones's design-family commit `6a7ce0437cb1b4b47f0eb03783e9268663879a23` is an ancestor of this candidate, with the subsequent phrase-aware retrieval and scoped brand-palette corrections retained. Candidate code also includes source-checkpoint preservation, canonical repair-path handling, workflow-owned-field guards, repeatable transaction updates separated from keyed checkout intents, and guidance addressing observed quantity, hook-order, and duplicate-editor failures. Their inclusion is source evidence; fresh runs must establish their effect on generated apps.

### Most recent independent product evidence

| Retained product | Observed behavior | Remaining limits |
| --- | --- | --- |
| Public Book, `dc6ca3ed41d8` | Independent two-record lifecycle passed: create, lend, edit while lent, filter, return, isolated delete, and reload preservation. Five real save-failure cases—create, edit, lend, return, delete—preserved saved state, displayed errors, and succeeded on retry/reload. | Original unchanged judge remains **9/10**: its return-status matcher rejects the app's correct `Home` label. Supplemental behavior evidence does not overwrite that report or invent a corrected aggregate. This run selected custom mode, so it does not qualify the new compiled default. UI is usable but modest; mobile actions consume excessive vertical space, and “on shelf” incorrectly labels the total owned-book count. |
| Assessment A, typed UI mode, `dc6ca3ed41d8` | Build and startup passed; source and repair evidence were retained. | Manifest-format and counter-binding failures persisted through five repair attempts: **zero supported journeys executed, seven remained unverified**. Source also contains a literal-zero counter defect. This is a failed experiment, not merely an evaluator mismatch; compiled UI journeys remain opt-in and off by default. |
| Public commerce, `84a607eb03d5` | Actual checkout, decline, current-stock rejection, atomic persistence, and save-failure/retry probes demonstrate a stronger durable transaction boundary. | Retained app fails its production build, misuses permanent keys for repeatable catalogue operations, crashes when a second distinct cart line is added, and accepts fractional candle quantities. Independent probes preserve these failures. The relevant reusable API changes, repair-path fix, and generation guidance are included in `8fba03d`; fresh commerce proof remains pending. |

The evidence is retained in evaluator `evidence/final-push-2026-09-04/`:

- `calibration/book-dc6-final-audit/`: unchanged source hashes, original judge, real browser lifecycle, five storage-fault/retry cases, desktop/mobile screenshots.
- `runs/holdout-a-dc6ca3ed41d8-2026-09-04T17-09-00.521Z-e21ebead/typed-manifest-final-observation.json`: exact manifest errors, unverified coverage, and source findings. Those format failures are not all attributable to the separate repair-path bug.
- `calibration/commerce84-final-audit/`: transaction probes, repeat-operation failures, two-line crash, fractional quantity reproduction, verification/repair provenance, and screenshots. The original and supplemental evaluator reports remain unchanged; no replacement aggregate score is asserted.

Fresh generation from the exact selected configuration is still pending. This record does not establish repeatability, unfamiliar-prompt transfer, superior visual quality, or a token/cost performance advantage. Retained successful examples and source tests inform candidate selection; they do not replace qualification of its actual outputs.

## Historical checkpoint, 15:10 UTC

The following sections preserve the earlier state and its contemporaneous conclusions. References to defaults, outstanding work, and collaborator assignments below apply to their dated checkpoints, not the current candidate above.

The private `final-push/2026-09-04` branches preserved this development base while `main` remained the MVP. This was not a claim of final candidate qualification.

### Integrated source at 15:10 UTC

Harness merge `41a91f540baeed17851c2caf44b0e2b766021831` combines experimental compiler `9c8ee36d74e26ba23decd779ab06866351c88650` with reliability changes through `92e3ad5`. Evaluator revision: `6d304d0908c04213fe9bb4bfbff5a076a1bea041`.

Native Node 22.19.0 validation: harness typecheck, 197/197 tests and app build passed; evaluator 30/30 tests passed. The empty app-template test suite is not generated-product evidence. A shared dependency-cache rename warning appeared during simultaneous disposable Vite fixtures; all tests and readiness checks passed. Fresh model generation from this combined revision remains outstanding.

### Actual generated products at 15:10 UTC

Fresh GLM-5.2 runs of earlier compiler revision `d6f81aa158588f53e3186581f059b5ce9aa8a096`, evaluator `fc8d43e50cf885c145bde5c895e587d6cb78f6a2`, used thinking off, a 32,768 response cap and `CHALLENGE_EXECUTABLE_COLLECTION=1`. Both selected compiler-owned domains and eventually passed generated internal verification after repairs.

| Product | Independent final journeys | Additional observations |
| --- | --- | --- |
| Shelf Ledger, public Book prompt | 10/10 | Create, lend, edit, return, delete, category preservation and reload work. Failed storage preserves mounted UI, saved state and draft with visible errors. |
| FeedbackLane, public SaaS prompt | 7/7 | Request creation, filters, categories, forward workflow and reload work. Failed storage preserves state and draft with visible errors. |

These totals use evaluator `6d304d0` on byte-identical retained final apps. Original reports were 3/10 and 3/7 because the evaluator assumed row-contained editors or exact category/filter copy. Calibration accepts named external forms/dialogs and semantic controls. Deliberately broken category persistence, priority filtering and action entry/submission still fail. Original reports and intermediate calibrations remain retained; no app was hand-patched to improve its result.

Local evidence under evaluator `evidence/final-push-2026-09-04/`:

- Runs `book-lending-d6f81aa15858-2026-09-04T14-15-17.287Z-70a459a3` and `saas-feedback-d6f81aa15858-2026-09-04T14-15-32.518Z-c631e735`.
- `calibration/book-affordances-compiled-2/` and `calibration/saas-affordances-compiled-2/`: final independent reports and evaluator provenance.
- `calibration/book-affordances-compiled-1/save-failure.json`: compiled recovery versus custom implementations that blanked the root.
- `calibration/compiled-visual-2026-09-04/book-desktop.png`, `feedback-desktop.png` and `feedback-mobile.png`: unmodified generated interfaces populated through visible UI actions.

The list and board compositions differ, but visual quality is still ordinary: Book has a weak-contrast return action; Feedback has uneven empty-state alignment and mobile spacing. Some controls are below the requested touch-target size. Polish and generalization remain open work.

### What those integrated changes address

- Supported flat collection behavior is compiled, including guarded transitions, editing, hidden state preservation and atomic save/recovery. Generated App, CSS and independent UI journeys remain free. Unsupported domains retain custom generation. The experiment remains opt-in.
- Exact field bindings and audited unambiguous container normalization reduce avoidable interpretation repairs. Identifier aliases cannot shadow business fields. Offline replay reduces observed draft submissions; this is not measured fresh-run token savings.
- Complete initial writes terminate natively after the batch drains. Successful-write feedback names remaining files. Repairs can finish a successful mixed write/handoff batch without another completion request. Protected domain writes remain blocked.
- Builder context removes duplicated bookkeeping. Repair diagnostics group repeated errors while retaining affected journeys, unique failures and locations. A retained SaaS diagnosis shrank from 18,810 to 5,063 characters; this is not a measured token or quality claim.
- Compiled instructions use the actual supplied APIs and concise visible journeys. Incorrect helper-import guidance was removed. AppShell permits a product-chosen brand mark instead of forcing a first-letter box.
- Provider setup failures no longer consume substantive repair opportunities. Transport evidence retains original timeout causes and whether headers/body completion were observed.

### Limits and retained failures at 15:10 UTC

Earlier custom high-reasoning and custom fallback Book products both pass the corrected 10-journey judge but crash on simulated storage failure. The earlier commerce attempt timed out with incomplete source and untouched tests. An 8,192-token high-reasoning attempt spent responses on thinking without producing files. None is a successful candidate.

Generated tests are not an independent oracle: the compiled Book storage-failure test never submitted the form, and some repaired assertions became weaker. External fault injection established actual recovery. Interpretation also narrowed open category examples into closed choices; schema/compiler agreement cannot prove fidelity to the original prose.

Untouched assessment prompts have not yet been generated. Evidence does not yet establish repeatability, broad generalization, a token-efficiency winner, or superiority of higher reasoning. Failed attempts and unknown usage remain recorded locally.

### Collaboration surface at 15:10 UTC

Jones is taking generated design variety, coherence and quality. Branch from the latest pushed `final-push/2026-09-04`; his own tickets will describe his work when he starts. The coordinator continues reliability, fresh experiments and independent validation and integrates useful contributions at coherent milestones.

Compiled generation exposes `definition`, `recordKeys`, `useProductCollection` and `ProductEditor` from `src/product/domain.ts`. The compiler owns that file; the agent owns App, CSS and product tests. Custom generation still owns four files. Likely design touchpoints are `src/build-plan/blocks.ts`, builder prompts and `product.experience`; communicate overlap before changing compiler interfaces. There is no fixed page template to preserve. Each collaborator uses their own provider credentials and development allowance.


## Historical assessment update, 15:45 UTC

The first untouched `holdout-a` generation from harness504755d/evaluator6d304d0 failed. All three files initially completed in one8,426-token response, but generated tests had syntax and storage-assumption errors and the UI lacked a create entry point. Repairs eventually exhausted32 response slots and left duplicate `filter` declarations. The supplemental unchanged evaluator returned0/7 because the final app could not parse. No generated tests executed in the final version, and the independent save-failure probe could not run. Total metered output was33,525tokens. Full source, intermediate failures and supplemental report remain in `calibration/holdout-a-504755d-independent-audit/`. This first frozen assessment remains evidence; subsequent fixes informed by it make A a development example. Auditor exposure to B was limited to the shared adapter file; B's raw prompt remains unused for tuning.

The custom commerce run fromdc7ddc8 completed source and its final build/startup passed. Independent browser probes observed a working mixed-cart/decline/retry/persistence path but also actual defects: clearing quantity then typing2 produced12, lowering catalogue stock below cart quantity allowed overselling, and failed saves could produce false success messages and discard the draft. Those are observed product defects regardless of generated test scores.

The SaaS504755d run requested low reasoning, but the exact installed Pi/provider runtime maps low to high. Its first builder response produced68,506thinking characters and then a streaming error without files or final usage. No separate low-mode or high-quality advantage is established. A locally optional allowance lock later became stale when the ended A process was interrupted between lock creation and reservation persistence; this blocked later commerce/SaaS requests. Their completion/cost comparison is therefore contaminated by that local experiment failure. Original output, refused requests and accounting history are retained, and lock recovery is being audited before further spending. This personal opt-in guard does not apply to collaborators' runs when unset.

The next reliability work targets earlier return from successful repair batches to real verification, retention of a previously buildable candidate when a later repair regresses it, and an opt-in investigation of compiler-owned UI journeys while keeping product JSX/CSS free. These are ongoing changes, not validated improvements in fresh generation yet.
