# Candidate evidence, 4 September 2026

Development record at 14:10 UTC. This is not a release or a claim of submission readiness. The private `final-push/2026-09-04` branch preserves the work; `main` remains the MVP.

## What the latest completed generations show

The `7d022bf` Book run failed qualification. Its final build and startup passed, but three generated assertions expected the wrong visible state or wording. A disposable test-only calibration fixed those expectations and produced ten passing assertions; Vitest still exited unsuccessfully because the app threw an unhandled storage exception. The app published new React state before saving it, while its own recovery test wrongly accepted the unsaved record. Its optional collection definition was unused. Browser inspection also confirmed a duplicate React mounting warning. The warm serif layout and compact responsive rows improve on the early output, but do not establish exceptional design or reliable generation.

The same revision's commerce run reached its outer timeout with tests still untouched and two remaining App compilation errors. Three request timeouts and an unfinished retry make the reported usage incomplete. This output is retained as a failure, not a working commerce candidate.

The high-reasoning Book run at the old 8,192-token response cap used two whole builder/repair responses for reasoning without writing files. Its complete reported usage was retained, but no application was produced. The new configurable response cap makes a better-configured trial possible; it does not by itself show that higher reasoning wins.

Detailed independent audit and disposable calibration: `/private/tmp/acf-final-failure-audit-2026-09-04/REPORT.md`. Original runs remain under the evaluator's `evidence/final-push-2026-09-04/runs` directory. No failed app or original report was overwritten.

## Changes supported by those failures

- A repair diagnosis is marked attempted only after a completed non-error model response. A provider startup failure no longer consumes the opportunity to address that unchanged diagnosis.
- The installed official Berget initializer now has a small bounded retry wrapper for transient catalog failures. Permanent errors remain errors; model metadata, pricing, capabilities and auth still come from the installed provider.
- Initial file generation terminates inside Pi after all distinct owned files succeed and the current tool batch drains. Installed Pi against a local HTTP server proved exactly one request for complete three- and four-file batches, with no synthetic aborted response. Duplicates, failed writes and protected-path attempts cannot substitute for a missing file. Repairs keep their explicit handoff behavior.
- Builder context drops repeated provenance, reciprocal journey mappings, block configuration and ownership bookkeeping. Complete canonical artifacts remain intact; any additional verification checks remain explicit. The first projection reduction measured 2,138 net characters on the retained public Book spec before the further block-config removal. This is a character measurement, not a measured token saving.
- Custom-generation guidance explicitly assigns mounting to the linker and requires saving the complete next state before publishing it, with visible errors and retained drafts on failure.

The combined native suite passed 160 of 161 tests before one stale assertion was updated from the upstream extension path to the new official-provider wrapper path. The affected six-test suite then passed; typecheck and app build passed. The new provider seam and in-process completion tests exercise the installed runtime without inference spending.

## Experiments still unresolved

Fresh runs started at 13:58/13:59 UTC compare a current custom generator with a 32,768-token reasoning allowance and an opt-in executable-collection branch at 8,192 tokens, both through Berget GLM-5.2. They are exploratory candidates, not a single-variable A/B test. They share a raw public Book prompt but independently interpret it.

The opt-in run selected custom fallback. Its initial compiled draft was representable, but alignment errors and misleading fallback advice caused the model to abandon it. That run therefore assesses the fallback, not the compiled domain. A subsequent isolated change is improving contract alignment and diagnostics; fresh compiled-path generation is still required.

The compiler experiment preserves free product JSX/CSS and independent generated journeys while owning suitable flat collection behavior. Its offline tests are feasibility evidence, not fresh-model, generalization or cost evidence. Untouched assessment prompts remain reserved for a stronger candidate.

Accounting retains full conservative allowances for requests with unavailable final usage. Those allowances are not observed spending, and the cumulative proxy is not verified euro billing. No additional credit was purchased.
