# Research decisions — 4 September 2026

Rafael supplied two Deep Research reports during implementation: public competition reconnaissance and Caveman/token-efficiency research. Their recommendations are starting evidence; the accepted development goal and organizer constraints remain authoritative.

## Controlled concision

Primary sources inspected: [Caveman README](https://github.com/JuliusBrussee/caveman), [JetBrains' paired coding-agent experiment](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/), and [Z.AI's thinking documentation](https://docs.z.ai/guides/capabilities/thinking). Caveman's maintainers explicitly warn that instruction overhead can outweigh savings on already terse work. JetBrains reports 8.5% output savings across 82 paired tasks; that result concerns its Claude coding-agent workload, not our GLM harness.

Our retained `a29d363` Book run has a more direct diagnosis. Its three interpreter responses and four initial builder responses contain tool calls only. Repair attempt 2 consumes 20 responses and 8,408 output tokens, with prose in 19 responses. This breakdown uses stage event streams once each, excluding their duplicated aggregate stream; character counts are not tokenizer measurements. Eliminating unproductive rounds is the stronger immediate opportunity. The explicit `finish_repair` handoff is being tested on a fresh run.

The following `af78804` run also exposed an avoidable cost: the builder rewrote a 7,635-character test file to satisfy our 6,500-character prompt limit, although the original response used only 1,940 output tokens. Arbitrary character limits have therefore been removed. Complete independent writes/edits may share a response; the existing process handler drains all tools in a response and requires all distinct product files. Complete code, tests, and design remain the objective.

The installed Berget provider supports GLM-5.2 thinking off/high/max, consistent with the upstream documentation. A matched reasoning-enabled implementation experiment is warranted: additional reasoning is useful only if quality or avoided repair justifies its measured cost. Provider accounting must include every attempt and every generated token. The report's Z.AI/GreenPT provider assumptions do not replace the contest's Berget requirement.

## Competitive evidence

Primary-source inspection confirmed useful mechanisms in public implementations. [CompileKit's presentation selection](https://github.com/prabhuAI/agentHarness/blob/d479035f3662b9a2108c689e07b439793a2fa1f6/solution/design/presentation.ts) separates task-appropriate views from [complete theme settings](https://github.com/prabhuAI/agentHarness/blob/d479035f3662b9a2108c689e07b439793a2fa1f6/solution/design/catalog.ts). Our experience brief now makes that distinction explicit while retaining free product composition. Its committed 20/20, median 2,600.4 weighted-token report is a self-reported benchmark, not an independently reproduced comparison or confirmed organizer result.

[Locollabs' sampling extension](https://github.com/damanso/agentcofounder/blob/8d8fba571d4d08e3fbe0beb9dd053607e01c0aaa/solution/extensions/sampling.ts) sets low temperature and explicit chat-template thinking controls. Offline inspection of our installed SDK confirms that it emits top-level `reasoning_effort` but no `chat_template_kwargs`. This proves request shape only: Berget may already translate the setting. A small controlled provider probe should precede conclusions or default changes.

CompileKit's explicit capability routing reinforces measuring where our optional controller fits. Its particular keyword heuristics are not proof of semantic coverage. Public edit-thrash guards likewise reinforce stopping waste, but their arbitrary thresholds and test-shortening interventions do not justify changing our preservation of assertion intent. No competitor implementation was executed or copied into the harness.

Our current experiment shares dependable collection behavior while leaving product JSX and CSS generated. Hand-authored Book/Garden examples establish that this permits distinct composition, not that fresh generation achieves it. Fresh generated outputs, independent journeys, and desktop/mobile review decide adoption.

## Deterministic draft fields

The interpreter may now omit draft `version`, requirement `disposition`, and requirement `journey_ids`. Expansion supplies version 0.1, derives disposition from provenance, and reconstructs reciprocal journey links from acceptance journeys. Existing full drafts remain supported. Explicit invalid values remain visible to the unchanged canonical schema and semantic validator. Source provenance, fragment classifications and notes, experience briefs, and acceptance outcomes remain model-authored.

Offline replay of the accepted public Book drafts, including their retained repairs, produced exactly the same saved canonical ProductSpecs after these omissions. The `af788045b23c` draft shrank from 11,213 to 10,484 compact JSON characters (729; 6.50%); `a29d363b6ba2` shrank from 9,492 to 8,785 (707; 7.45%). Dividing saved characters by four gives approximately 182 and 177 token proxies, not measured GLM token savings. Fresh runtime measurements must establish the actual effect. Focused regressions cover canonical identity, all provenance mappings, invalid explicit values, missing journey coverage, and repair through the authoritative journey references. No provider calls were needed for this proof.
