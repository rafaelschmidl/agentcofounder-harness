# Organizer constraints and second-pass strategy — 4 September 2026

> This is the historical strategy assessment. Subsequent user decisions in [the setup record](setup.md) take precedence: use native macOS during development and defer Docker validation and public release preparation to the final delivery window after candidate selection.

This is a second assessment, before Plan mode or goal activation. No implementation, paid generation, publication, or messaging was performed. Organizer messages are evidence about the competition, not authorization to act on Rafael's accounts.

## Authority and time

Working precedence requested by Rafael: the latest applicable clarification from a named organizer in Slack takes precedence over older website/checklist language. Preserve the scope of each reply: an exemption for a BYO framework is not automatically an exemption for the starter/Pi track. If Slack leaves a detail unresolved, say so rather than reinstating an older conflicting statement as settled fact.

Ali's September 4 statement is that speed is not part of the evaluation metrics. It does not explicitly promise unlimited execution time or state that a timeout in submitted code will be overridden. Therefore:

- Do not optimize for a supposed official 15-minute limit; no such limit was confirmed in the reviewed organizer messages.
- Treat elapsed generation time as diagnostic and as a limit on how much experimentation we can complete today.
- Retain bounded, configurable execution for recovery and operational safety. Resolve the effective judged-run time limit if possible.
- Token/cost efficiency and application quality remain relevant even when speed is unscored.

## Complete applicable organizer register

| Date and organizer | Latest applicable statement | Scope / implication |
| --- | --- | --- |
| Sep 4, Ali, 11:08 | Speed is not an evaluation metric; all contributions use the same underlying model. | Slower provider throughput does not itself reduce the score. No explicit universal wall-clock-limit waiver. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788512913104349?thread_ts=1788426251.195579) |
| Sep 4, Prince, 11:23 | September 4 is submission day. Instant email confirmations are enabled; the email is official receipt. Earlier entries without confirmation were not recorded and must be resubmitted. | A form click alone is insufficient evidence of entry. Exact cutoff timezone is not stated in this message. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788513822232009) |
| Sep 3, Ravi, 10:26–10:30 | Judging uses Apple Silicon; target Linux ARM64. | Native binaries, bundled libraries, and any prebuilt data must be compatible. ARM64 alone is sufficient. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788424012856639?thread_ts=1788382723.059909) |
| Sep 3, Ravi | They run the submitted Dockerfile and runtime, rather than imposing their image. | In replies about custom/BYO environments. Python 3.12 is acceptable; there is no reason for our established Node system to migrate. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788424241433059?thread_ts=1788303090.825439) |
| Sep 3, Ravi | Starter track runs `npm run challenge`; BYO runs the documented command. | Track choice and run instructions must accurately describe the submission. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788424241433059?thread_ts=1788303090.825439) |
| Sep 3, Ravi | Build-time network is open. At runtime, assume no outbound access except the model provider. | Install/bundle dependencies, fonts, icons, and required assets before the judged run. Avoid runtime external-service assumptions. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788424241433059?thread_ts=1788303090.825439) |
| Sep 3, Ravi | Custom frameworks may call the gateway directly; Pi-specific schema fields do not bind frameworks that do not use stock Pi. | BYO still reports status, summary, implemented features, assumptions, tests, token counts, and call log, with raw framework logs. This is not a reason to weaken our existing Pi audit trail. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788424241433059?thread_ts=1788303090.825439) |
| Sep 3, Ravi | Every model call counts, including retries and orchestration. | Multiple agents or candidates during a judged run consume scored usage; keep accounting complete. Exact external verification of counts remained under discussion. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788424241433059?thread_ts=1788303090.825439) |
| Sep 3, Ravi | Multiple Pi invocations are allowed. Retain individual invocation logs and reconcile their totals with the call log. | Stated in the BYO discussion. There is no organizer basis here for our arbitrary four-write completion rule or a mandatory single invocation. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788424241433059?thread_ts=1788303090.825439) |
| Sep 3, Ravi | Put run command, test command, and exact judged SHA in submission notes. | Make the review reproducible without inferring branch state. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788424241433059?thread_ts=1788303090.825439) |
| Sep 3, Ravi | Stock Node checks and their short probes are not gates for the custom runtime discussed; the submission must build and run. | May adjust incompatible stock checks for that runtime. Does not exempt our submission from functional correctness or make all timeouts irrelevant. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788424012856639?thread_ts=1788382723.059909) |
| Sep 3, Ravi | No additional organizer repository-size limit for the roughly 300 MB example discussed. | Ordinary GitHub limits still apply. This permits necessary bundling; it is not a reason to add large irrelevant artifacts. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788424012856639?thread_ts=1788382723.059909) |
| Aug 31, Ali | Sep 4 submission; Sep 7 top-three announcement; Sep 10 main-stage presentation; Sep 11 winner. | Newer Slack schedule takes precedence over the site's Sep 6 finalist date. The timeline image matches the Slack text. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788160106688109) |
| Aug 31, Ali | After finalists are announced, organizers share the hidden prompt. | The final stage demonstration must use that exact prompt. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788160427844519?thread_ts=1788160106.688109) |
| Aug 31, Ali | One-minute accelerated harness video plus three-minute explanation of the solution, architecture, strengths, and results. | Prepare reusable recording/evidence now; final production follows the revealed prompt. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788160427844519?thread_ts=1788160106.688109) |
| Aug 31, Ali | Audience votes inform the judges' decision; presentation matters. Ravi and Ali are technical referees. | Technical qualification and persuasive communication both matter, at different stages. The precise vote weighting was not stated. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788160106688109), [follow-up](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788160427844519?thread_ts=1788160106.688109) |
| Aug 25, Ravi | Book Lending is the final public prompt. Hidden prompt differs but is similar in structure, difficulty, app kind, and scale. | Strong evidence for prioritizing nearby small workflows over broad SaaS expansion; not permission to hard-code Book Lending. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1787652189448559?thread_ts=1787508281.524389) |
| Aug 21, Ali | Precise readiness/efficiency weighting was not finalized. | No later resolution appeared in the reviewed messages. Treat the website's strict weighted-token ranking and exact readiness allocation as provisional where they conflict. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1787290657578039?thread_ts=1787247519.722209) |
| Aug 20, Ali | GLM-5.2 through Berget is the sole judging basis; smaller models such as Qwen 3.8 27B are comparative research. | Develop final runtime evidence on GLM-5.2. A faster alternative model is not an equivalent contest validation. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1787209911597849?thread_ts=1787171181.834139) |
| Aug 20, Ali | Pi-reported runtime cost may be used; organizers handle discrepancies with Berget. | Preserve raw usage and Pi cost. Continue reporting the published weighted-token number separately for comparison, without claiming its ranking authority is settled. [Source](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1787209911597849?thread_ts=1787171181.834139) |
| Aug 18, Prince | Compound systems may use Pi, LangChain, AutoGen, or custom frameworks; emit required `result.json` telemetry. | Framework choice is flexible. Later track-specific clarifications narrow the packaging/reporting details. |

Additional live submission-form constraint: **a public GitHub repository link is required**. Team name, contact email, and entry track are required; demo/video and notes are optional fields. Notes nevertheless carry the organizer-requested commands and SHA. Both current repositories remain private from the first-pass live GitHub verification. [Form](https://agentcofounder.stockholm.ai/submit.html).

Unresolved rather than assumed:

1. Any externally enforced total generation timeout and which timeout overrides judges will supply.
2. Exact per-response output-token limit. A September 3 participant question remains unanswered in the reviewed results. [Question](https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788390535215629).
3. Final readiness/efficiency weighting, cache-write treatment, and count-verification procedure.
4. Exact submission cutoff timezone; whether and how an earlier recorded entry can be updated to a later SHA before cutoff.
5. Audience/judge vote weighting and detailed finalist-selection rubric.

The useful clarification message to prepare, not send automatically, asks about the effective time/output limits, final scoring balance, and submission cutoff/update semantics. None of these should halt work on complete output, meaningful UX, faithful requirements, or reliable packaging.

## A stronger way to develop and experiment

Separate reusable development work from the judged run. Codex and the authorized development budget can build components, analyze traces, improve prompts, assess screenshots, replay failures, and challenge the evaluator. The judged raw-idea run still needs to produce its result autonomously using the permitted model, with every runtime model call counted. Hand-edited prototype screens can inform a reusable design, but final evidence must come from a fresh harness generation.

### Cheap experiments that improve confidence first

- **Test the evaluator with deliberate defects.** In disposable retained-app copies, make a filter do nothing, disable persistence, break a derived count, remove styling, and leave a misleading success report. Require the appropriate check to fail while the unchanged app still passes. Strengthen only meaningful blind spots; avoid building an elaborate new evaluation platform.
- **Replay completion and repair failures.** Exercise duplicate writes, missing CSS, untouched test placeholders, malformed specifications, failed assertions, and interrupted tools. Require complete recovery or an honest incomplete result, with bounded retries. This is largely model-free work.
- **Prototype design alternatives offline.** Compare richer design instructions, stronger reusable UI primitives, and model-selected layout/identity. Inspect identical populated/error/mobile states before buying full generation comparisons.

### Paid experiments should select between hypotheses

| Hypothesis | Fair comparison | Decision evidence |
| --- | --- | --- |
| Strong reusable UI improves quality more than additional verbal art direction alone | Same fresh prompt, comparable run conditions, screenshots labelled A/B | Primary action clarity, hierarchy, mobile task completion, independent journeys, runtime tokens |
| The interpreter understands meaning rather than familiar wording | Fresh idea, meaning-preserving paraphrase, and a meaningful requirement change | Behavior invariant under paraphrase; changed behavior for changed requirements; explicit exclusions preserved |
| Small schema corrections need not resend the full specification | Replay a rejected draft, then compare validated patch repair | Only intended fields change; validator still enforces full meaning; calls/output saved |
| The builder needs less audit metadata in its prompt | Full context versus compact execution projection | Same requirements and outcomes, preserved provenance files, measured end-to-end cost/tokens |
| A compact declarative path can generate polished small apps more efficiently | Existing route versus configuration-driven renderer on public plus frozen unseen cases | Full requirement coverage, better/equal UX, substantial measured saving, explicit fallback for unsupported semantics |
| The chosen release is repeatable | Freeze SHA, use an untouched final challenge set plus repeated public input | Per-run outcomes, repair counts, complete artifacts, reconciled usage, clean environment execution |

Start with a small selection set and reserve different prompts for final assessment. Once a prompt drives a fix, it is development evidence. Freeze expected outcomes before generation; keep the evaluator's answer key outside harness inputs. Judge filtering with records on both sides of the filter and persistence with specific record/state values, not generic words on the page.

Track cost per accepted app across all attempted runs, not just the best successful run. Also retain completion, requirement omissions, incorrect additions, visual review, repairs, tokens, and elapsed time. These are our decision metrics, not a claimed official combined score. A few runs support a comparison, not a statistical reliability guarantee.

## New opportunities and their relative risk

### 1. Shift more work into reusable implementation

This is the largest plausible efficiency opportunity identified. Current capability blocks provide utilities while GLM still writes substantial domain, React, CSS, and test code. For a supported small-app class, let the model specify entities, fields, actions, transitions, filters, counts, validation, and visual identity; let tested reusable code provide the implementation.

The configuration must be rich enough to express the raw idea, and a deterministic coverage check must reject unsupported requirements. Keep the existing builder as a fallback. Select by typed capabilities, not domain-name matching. Generated configuration-derived tests remain insufficient by themselves; retain raw-idea-based independent journeys.

This is a higher-risk experiment, not an adopted architecture. Give a feasibility spike about 90 minutes after the mandatory completion fix; a credible narrow implementation and validation may take 3–5 hours. Continue only if it demonstrates a substantial benefit and leaves release time intact. A proposed adoption bar is at least a threefold weighted-token improvement with no fidelity loss and visibly strong UX across unfamiliar cases; that bar is internal and adjustable.

### 2. Retain rich evidence without repeating it to every model stage

`agentcofounder-harness/src/builder.ts:52–60` sends the full pretty-printed ProductSpec and BuildPlan. Retained examples contain approximately 29–39 KB of those artifacts. A read-only projection retaining execution-relevant meaning shrank them to about 11–14 KB. The roughly 63% character reduction is not a measured token or total-score saving.

Keep the full provenance artifacts on disk. Send each stage the requirements, constraints, interfaces, and outcomes it needs. This is a comparatively low-risk 45–90 minute candidate.

### 3. Repair values rather than regenerate documents

The retained Book interpretation re-emitted about 3,029 output tokens mainly to correct one DEFAULT source reference; commerce re-emitted about 4,081 mainly to correct actor references. The existing `submit_product_spec` tool requires full-draft resubmission. A retained rejected draft plus bounded field/JSON-patch repair can remove this waste while retaining the same full validator. Estimated effort: 45–90 minutes, with offline replay and a focused live tool test.

Output tokens account for approximately 62–68% of the published weighted metric in the three retained final runs. Input compression therefore helps, but reducing repeated code/spec generation addresses the larger measured contributor. These percentages describe the website formula; they do not settle organizer ranking policy.

### 4. Prove purposeful design, not only consistent decoration

Assess whether someone can immediately understand the app, perform its main action, see current state, recover from a mistake, and trust that a reload preserves their work. Give the model a concise product brief: primary user, main job, first meaningful action, vocabulary, and essential states. Use an offline-bundled foundation for typography, focus states, controls, layouts, and visual tokens, with product-appropriate composition. Avoid requiring external images, fonts, or services during judging.

### 5. Make the submission understandable before the final hour

The harness README still opens with “AgentCofounder starter” and describes one Pi invocation. It obscures the actual System v0 contribution. Build the reviewer-facing entry point alongside engineering: a clear description, actual architecture, exact command/model/SHA, one generated workflow, honest measurements, and concise limits. Keep a known acceptable candidate available as experiments continue.

A matched before/after comparison against our current MVP is cheap and defensible. A same-model official-starter baseline could be useful if it runs fairly with little setup; do not let it displace final candidate validation or claim comparative superiority without matched evidence.

### 6. Make the eventual demonstration explain why the harness is useful

Capture actual generation phases and one complete product journey: create a record, change state, reject an invalid action, reload, and retain state. Retain prompt/SHA/cost metadata and distinguish product assumptions in the report from actual UI actions. One real automatically diagnosed repair can explain the system's value better than a long architecture lecture, but never stage a fake repair or interrupt the main qualification work for production polish.

The strongest defensible story is: the model interprets the idea and makes product choices; reusable code supplies reliable behavior; independent checks establish what works. Today's repository/evidence can demonstrate this. The final one-minute video must later use the organizers' revealed prompt.

## Recommended direction before planning

First fix the proven delivery defect and calibrate the handful of consequential acceptance checks. Start the public-release package early. Give generated UX and unfamiliar Book-scale behavior the largest discretionary share. Run compact-contract and patch-repair candidates as low-risk efficiency experiments, and consider one strictly bounded configuration-renderer spike for higher upside. Select improvements from evidence, retain a working candidate, and reserve uninterrupted final validation/submission time.

Do not optimize against an invented 15-minute official limit or a claimed settled token-only ranking. Do not assume unlimited runtime either. The plan should name uncertainty explicitly and choose improvements that remain valuable across the plausible judging interpretations.


## Organizer clarification observed at 15:34 UTC, September 4

Ravi Singh posted at15:24 Stockholm that the final submission should include the exact pushed commit SHA in the form’s Short Notes / Highlights field. The submitted repository URL alone does not identify the deadline revision; organizers will judge the supplied SHA. The commit must be pushed and public at submission, must remain resolvable, and an already-submitted team can submit again with the SHA, with the later entry used. Source: https://sthlmai.slack.com/archives/C0BR06UDB1A/p1788528245058219?thread_ts=1788513822.232009&cid=C0BR06UDB1A .

This updates the eventual submission handoff only. It does not authorize publication or submission during the accepted development goal, and it does not add a runtime or development deadline. Existing source snapshots and exact revision evidence already support this requirement.
