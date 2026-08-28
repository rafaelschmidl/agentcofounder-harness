# Product customizer

Implement the product-specific experience described by the supplied ProductSpec and BuildPlan.

The deterministic compiler has already materialized infrastructure and typed interfaces. Their exact contents are supplied below, so no file reads are needed. You may write only the AGENT-owned files listed in BuildPlan. Do not request new dependencies, change configuration, edit system modules, or write runner artifacts.

The complete interpretation, build, and repair loop has a shared bounded response budget. Do not output analysis, planning, explanations, code fences, or prose. Your first response must immediately call `write`. Write exactly one complete AGENT-owned file per response, using one `write` tool call. Use this order: `src/product/domain.ts`, `src/product/App.tsx`, `src/product/product.test.tsx`, then `src/product/styles.css`. Keep every file below 9,500 characters so its complete tool arguments fit in one response. After the fourth successful write, stop. Deterministic verification will provide targeted failure evidence if repair is needed.

Required work:

1. Implement all IMPLEMENT requirements and no PROPOSE or EXCLUDE requirements.
2. Use the materialized repository, collection, workflow, transaction, payment, UI, and verification interfaces when selected.
3. Keep product-specific entities and domain operations in `src/product/domain.ts`.
4. Build the complete accessible interface in `src/product/App.tsx` with visible validation and recoverable errors.
5. Create a deliberate responsive visual system in `src/product/styles.css` suitable for the product domain.
6. Replace the placeholder test with observable Vitest and Testing Library journeys in `src/product/product.test.tsx` for every BuildPlan verification obligation.

Give every visible control a unique contextual accessible name when creation, editing, filtering, or checkout reuse the same concept. In tests, scope repeated controls to their form, card, row, or region with `within`; never rely on an unscoped singular query when multiple matching elements are valid. The BLOCK-owned test setup cleans the DOM after every test.

`App` must render safely as `<App />`. Create default repositories, providers, arrays, objects, and callbacks at module scope or stabilize them with `useState` or `useMemo`; never create a default object or function in the component parameter list when an effect depends on it.

Keep `product.test.tsx` compact: at most one focused test per verification obligation plus any essential domain invariant, and below 6,500 characters. Prefer domain-function tests for rules and a small number of observable UI journeys. Never query `role="form"` unless the form has an explicit accessible name. Never use a broad singular `getByText` when the same wording can legitimately occur in an option, status, notice, or card. For validation, locate the relevant field or region and assert the corresponding alert's text content; do not query an alert by accessible name.

Do not use external services, network calls, authentication, or package installation unless the ProductSpec explicitly requires them. Do not merely describe the implementation: finish by writing all four AGENT-owned files.
