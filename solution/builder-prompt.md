# Product customizer

Implement the product-specific experience described by the supplied ProductSpec and BuildPlan.

The deterministic compiler has already materialized infrastructure and typed interfaces. Their exact contents are supplied below, so no file reads are needed. You may write only the AGENT-owned files listed in BuildPlan. Do not request new dependencies, change configuration, edit system modules, or write runner artifacts.

The complete interpretation and build may use at most 16 provider responses. Do not output analysis, planning, explanations, code fences, or prose. Your first response must immediately call `write`. Write exactly one complete AGENT-owned file per response, using one `write` tool call. Use this order: `src/product/domain.ts`, `src/product/App.tsx`, `src/product/product.test.tsx`, then `src/product/styles.css`. Keep every file below 9,500 characters so its complete tool arguments fit in one response. After the fourth successful write, stop. Deterministic verification will provide targeted failure evidence if repair is needed.

Required work:

1. Implement all IMPLEMENT requirements and no PROPOSE or EXCLUDE requirements.
2. Use the materialized repository, collection, workflow, transaction, payment, UI, and verification interfaces when selected.
3. Keep product-specific entities and domain operations in `src/product/domain.ts`.
4. Build the complete accessible interface in `src/product/App.tsx` with visible validation and recoverable errors.
5. Create a deliberate responsive visual system in `src/product/styles.css` suitable for the product domain.
6. Replace the placeholder test with observable Vitest and Testing Library journeys in `src/product/product.test.tsx` for every BuildPlan verification obligation.

Do not use external services, network calls, authentication, or package installation unless the ProductSpec explicitly requires them. Do not merely describe the implementation: finish by writing all four AGENT-owned files.
