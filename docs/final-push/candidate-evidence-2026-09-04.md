# Candidate evidence, 4 September 2026

Development checkpoint at 15:10 UTC. The private `final-push/2026-09-04` branches preserve the work; `main` remains the MVP. This is a stable development base, not a claim of final candidate qualification.

## Current integrated source

Harness merge `41a91f540baeed17851c2caf44b0e2b766021831` combines experimental compiler `9c8ee36d74e26ba23decd779ab06866351c88650` with reliability changes through `92e3ad5`. Evaluator revision: `6d304d0908c04213fe9bb4bfbff5a076a1bea041`.

Native Node 22.19.0 validation: harness typecheck, 197/197 tests and app build passed; evaluator 30/30 tests passed. The empty app-template test suite is not generated-product evidence. A shared dependency-cache rename warning appeared during simultaneous disposable Vite fixtures; all tests and readiness checks passed. Fresh model generation from this combined revision remains outstanding.

## Actual generated products

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

## What the integrated changes address

- Supported flat collection behavior is compiled, including guarded transitions, editing, hidden state preservation and atomic save/recovery. Generated App, CSS and independent UI journeys remain free. Unsupported domains retain custom generation. The experiment remains opt-in.
- Exact field bindings and audited unambiguous container normalization reduce avoidable interpretation repairs. Identifier aliases cannot shadow business fields. Offline replay reduces observed draft submissions; this is not measured fresh-run token savings.
- Complete initial writes terminate natively after the batch drains. Successful-write feedback names remaining files. Repairs can finish a successful mixed write/handoff batch without another completion request. Protected domain writes remain blocked.
- Builder context removes duplicated bookkeeping. Repair diagnostics group repeated errors while retaining affected journeys, unique failures and locations. A retained SaaS diagnosis shrank from 18,810 to 5,063 characters; this is not a measured token or quality claim.
- Compiled instructions use the actual supplied APIs and concise visible journeys. Incorrect helper-import guidance was removed. AppShell permits a product-chosen brand mark instead of forcing a first-letter box.
- Provider setup failures no longer consume substantive repair opportunities. Transport evidence retains original timeout causes and whether headers/body completion were observed.

## Important limits and retained failures

Earlier custom high-reasoning and custom fallback Book products both pass the corrected 10-journey judge but crash on simulated storage failure. The earlier commerce attempt timed out with incomplete source and untouched tests. An 8,192-token high-reasoning attempt spent responses on thinking without producing files. None is a successful candidate.

Generated tests are not an independent oracle: the compiled Book storage-failure test never submitted the form, and some repaired assertions became weaker. External fault injection established actual recovery. Interpretation also narrowed open category examples into closed choices; schema/compiler agreement cannot prove fidelity to the original prose.

Untouched assessment prompts have not yet been generated. Evidence does not yet establish repeatability, broad generalization, a token-efficiency winner, or superiority of higher reasoning. Failed attempts and unknown usage remain recorded locally.

## Collaboration surface

Jones is taking generated design variety, coherence and quality. Branch from the latest pushed `final-push/2026-09-04`; his own tickets will describe his work when he starts. The coordinator continues reliability, fresh experiments and independent validation and integrates useful contributions at coherent milestones.

Compiled generation exposes `definition`, `recordKeys`, `useProductCollection` and `ProductEditor` from `src/product/domain.ts`. The compiler owns that file; the agent owns App, CSS and product tests. Custom generation still owns four files. Likely design touchpoints are `src/build-plan/blocks.ts`, builder prompts and `product.experience`; communicate overlap before changing compiler interfaces. There is no fixed page template to preserve. Each collaborator uses their own provider credentials and development allowance.
