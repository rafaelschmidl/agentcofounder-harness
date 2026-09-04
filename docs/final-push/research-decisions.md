# Research decisions — 4 September 2026

Rafael supplied two Deep Research reports during implementation: public competition reconnaissance and Caveman/token-efficiency research. Their recommendations are starting evidence; the accepted development goal and organizer constraints remain authoritative.

## Controlled concision

Primary sources inspected: [Caveman README](https://github.com/JuliusBrussee/caveman), [JetBrains' paired coding-agent experiment](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/), and [Z.AI's thinking documentation](https://docs.z.ai/guides/capabilities/thinking). Caveman's maintainers explicitly warn that instruction overhead can outweigh savings on already terse work. JetBrains reports 8.5% output savings across 82 paired tasks; that result concerns its Claude coding-agent workload, not our GLM harness.

Our retained `a29d363` Book run has a more direct diagnosis. Its three interpreter responses and four initial builder responses contain tool calls only. Repair attempt 2 consumes 20 responses and 8,408 output tokens, with prose in 19 responses. This breakdown uses stage event streams once each, excluding their duplicated aggregate stream; character counts are not tokenizer measurements. Eliminating unproductive rounds is the stronger immediate opportunity. The explicit `finish_repair` handoff is being tested on a fresh run.

The following `af78804` run also exposed an avoidable cost: the builder rewrote a 7,635-character test file to satisfy our 6,500-character prompt limit, although the original response used only 1,940 output tokens. Arbitrary character limits have therefore been removed. Complete independent writes/edits may share a response; the existing process handler drains all tools in a response and requires all distinct product files. Complete code, tests, and design remain the objective.

The installed Berget provider supports GLM-5.2 thinking off/high/max, consistent with the upstream documentation. A matched reasoning-enabled implementation experiment is warranted: additional reasoning is useful only if quality or avoided repair justifies its measured cost. Provider accounting must include every attempt and every generated token. The report's Z.AI/GreenPT provider assumptions do not replace the contest's Berget requirement.

## Competitive evidence

The public-repository report identifies promising compiler, typed-seed, and reusable-frame approaches. Primary-source verification is in progress. Published success rates and token scores are self-reported evidence until their fixtures, provider, implementation, and verification are understood; they are not directly comparable rankings.

Our current experiment shares dependable collection behavior while leaving product JSX and CSS generated. Hand-authored Book/Garden examples establish that this permits distinct composition, not that fresh generation achieves it. Fresh generated outputs, independent journeys, and desktop/mobile review decide adoption.
