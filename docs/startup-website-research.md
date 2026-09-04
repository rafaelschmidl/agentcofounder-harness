# Startup website archetype research

Last updated: 2026-09-04. Companion prompts: [`startup-website-research-prompt.md`](startup-website-research-prompt.md) (copy-paste research brief — merge its results here).

Purpose: source material for the `website.strategy.*` pattern cards in `solution/patterns/cards/`. Each category below records the site's goals in priority order, typical views with purposes, recurring components, category vocabulary (used as card `signals`), and example startups. This is pattern-level distilled knowledge: cards stay ~2 KB, so only the essentials survive into them.

Method: pattern analysis of well-known reference startups' websites (goals → page inventory → recurring components → vocabulary), biased toward what a competent small-scale MVP shows, not enterprise site maps. Enriched 2026-09-04 with the external research report (`../Startup-web-lib-report.md`, with cited UX/conversion sources).

## Cross-category discriminators (external report finding)

The clearest category signals for idea-to-pattern matching are **the object being transacted** (product vs. lead vs. signup vs. listing vs. post vs. appointment) and **the primary CTA verb** (buy vs. book a demo vs. sign up vs. book now vs. post/follow). The generic auto-generated failure mode is defaulting to a dashboard-with-CRUD-table regardless of category. The highest-leverage category-specific additions are the **"money pages"** — product detail (commerce), pricing (SaaS), listing detail (marketplace), feed (community), booking calendar (scheduling) — plus category-specific trust and empty-state handling.

---

## Category 1: Local / small commerce storefront

**Reference examples:**
- Allbirds (Shopify-powered D2C) — minimalist hero → product grid; one dominant CTA per view.
- Etsy shop front — catalog-first with filter-rich listings and social proof inline.
- Glossier — product storytelling plus strong "shop all" path; community proof.

**Goal priority:** sell product (convert browse → cart → checkout) > reduce purchase friction (clear pricing, stock, shipping info) > build trust for first-time buyers.

**Common mistakes of generic auto-generated sites:** no product detail page (flat list only); price/stock not attached to the buy action; no cart view, just counters.

## Category 2: B2B SaaS with demo-request motion

**Reference examples:**
- Salesforce — enterprise social proof, segment-picked landing paths, demo form everywhere.
- HubSpot — product-platform hero, big feature taxonomy, heavy case-study use.
- Linear — terser self-serve-leaning version: polished product shots, changelog, minimal form.

**Goal priority:** generate qualified leads / book demos > demonstrate product value quickly (visual proof) > establish credibility (customers, pricing logic).

**Common mistakes:** no pricing page at all; feature list as abstract paragraphs without any product visual; no single obvious demo/contact CTA.

## Category 3: Consumer app with signup/acquisition funnel

**Reference examples:**
- Spotify — single dominant "sign up free" funnel, tier comparison, device/ecosystem proof.
- Duolingo — onboarding-first marketing: fun, low-commitment start, streak/progress proof.
- Notion — freemium motion: template gallery as acquisition surface, download-first hero.

**Goal priority:** acquire users / drive signup or install > get to first value fast (onboarding) > set expectations of the app's core loop (feeds, streaks, templates).

**Common mistakes:** marketing-only site with no sense of the actual app surfaces; signup not treated as a first-class flow in the spec; missing empty/first-run states.

## Category 4: Two-sided marketplace

**Reference examples:**
- Airbnb — search-as-hero, trust stack (reviews, ratings, verified identity), host/seller parallel funnel.
- Fiverr — catalog-with-faces: listings carry seller identity; brief-gig two paths at signup.
- Zillow — search-first with map/list duality and rich listing detail pages.

**Goal priority:** make the two sides find each other and transact > acquire the scarce side (sellers/hosts/providers) > trust and safety signals (ratings, reviews, profiles).

**Common mistakes:** one undifferentiated user role instead of buyer/seller (or renter/owner) roles; no search + filter pattern; no trust layer at all (reviews/ratings absent).

## Category 5: Community / content platform

**Reference examples:**
- Reddit — feed-first: infinite browsable content, per-community identity, voting-as-signal.
- Substack — creator-first: publication pages, subscribe everywhere, reader-feed glue.
- Medium — reading experience as the product: clean article view, claps/responses, author profiles.

**Goal priority:** acquire members/creators (subscribe/join) > keep people engaging (feed, comments, reactions) > grow content supply (creator/publishing path).

**Common mistakes:** content behind flows that are invisible pre-signup with no public feed; no author/member identity; comment/reaction affordances missing from the content detail view.

---

## Card map (which categories became which card)

| Card ID | Category | Goal headline |
|---|---|---|
| `website.strategy.commerce@1.0.0` | Commerce storefront | Sell product end to end |
| `website.strategy.saas-demo@1.0.0` | B2B SaaS demo motion | Book demos / capture leads |
| `website.strategy.consumer-app@1.0.0` | Consumer app funnel | Acquire users, onboard to first value |
| `website.strategy.marketplace@1.0.0` | Two-sided marketplace | Let two sides find each other and transact |
| `website.strategy.community-content@1.0.0` | Community / content platform | Acquire members, publish, engage |
| `website.strategy.booking-appointments@1.0.0` | Booking / appointment scheduling | Convert visitors into confirmed bookings |

## Live-run quality comparison (task 5.2)

Baseline: docs/component-breakdown.md, run of 2026-09-03 on Book Lending (`contract-public/development-idea.txt`), pre-change harness.

| Metric | pre-change baseline (2026-09-03) | post-change (2026-09-04, this change) | Delta |
|---|---|---|---|
| Status / attempts | success, 1 run used 6/7 repair cycles | success, verified on attempt 1, 0 repair cycles | repair budget freed |
| Model calls | 16 of 32 | 11 of 32 | −5 calls |
| Input / output tokens | 40,239 / 13,537 | 7,626 / 21,082 | −81% input, +56% output |
| Cache read / write | 120,192 / 0 | 117,312 / 0 | ≈ equal |
| Weighted-token formula | 92,869 | 82,603 | −11% |
| Pi cost | €0.067 | €0.0498 | −26% |
| Interpreter first-call input | 3,872 | 1,555 | −60% (E1 evidence) |

Spec-quality observations (post-change run):
- `product.goals` are framed as user outcomes with counters and correction paths ("Know which books I own at a glance", "See how many books are lent out right now") rather than feature restatements.
- Views carry explicit purposes ("Book List — see all owned books in one list and toggle to see only those lent out").
- Retrieval behavior matches the no-category-mismatch scenario: the Book Lending idea is not a startup-category website, and the interpreter selected only mechanical cards (persistence, CRUD, metrics) — no `website.strategy.*` card was forced. Audit: `artifacts/runs/2026-09-04T15-33-55-922Z/interpreter/pattern-retrieval.jsonl`.
- Category-informed behavior (goals/views borrowed from `website.strategy.*` cards) could not be exercised by this run by design; it needs a run on a category-matching idea (e.g. the commerce or SaaS reference prompts).

Caveats: single live run per side, runs on different days; GLM non-determinism and the baseline's 6 repair cycles confound token attribution. Treat deltas as directional. Reading: input-side reduction is consistent with the compounding effect of one-attempt verification (fewer tool-result round trips), and the added prompt knowledge did not increase input cost.

## Enrichments from the 2026-09-04 external report

Per-category corrections and additions (merge candidates for the cards):

- **Commerce**: checkout should be a minimal-distraction flow; variant/size selection belongs on the product detail page; sticky add-to-cart with in-stock/sold-out states; empty-state and out-of-stock handling is a common auto-generated gap. Vocabulary adds: "add to cart", "buy now", "in stock", "free shipping", "sold out".
- **SaaS demo motion**: prefer dual CTA (book demo + self-serve trial); pricing page with real numbers measurably reduces drop-off (gating every tier behind "contact us" is a reported mistake); trust/compliance signals (security badges) and integrations grid are expected; sticky top-nav CTA. Vocabulary adds: "book a demo", "free trial", "per seat", "contact sales", "case study".
- **Consumer app**: onboarding-quiz-first funnels (Duolingo) personalize before signup; some consumer sites are near-zero marketing with download-first (Instagram) — the failure mode is defaulting to a SaaS-style demo form instead of direct signup. Vocabulary adds: "sign up", "get started", "download", "streak", "create account".
- **Marketplace**: dual-sided entry on the homepage (buyer search + "become a seller/host"); "no results" empty state is disproportionately important in thin two-sided markets; bidirectional reviews/ratings are the core trust primitive; price breakdown before checkout.
- **Community/content**: per-topic/per-community scoping beats a single global feed (Reddit model); engagement primitives (upvote/like, comment, follow) belong on the content detail view; an empty platform should look "new", not broken — seeded or empty-state content matters.
- **Booking / appointment scheduling (adopted 2026-09-04 as card `website.strategy.booking-appointments@1.0.0`)**: goals: convert visitors into confirmed bookings > minimize back-and-forth with real availability > reduce no-shows. Views: service list, service/provider detail, booking calendar with time-slot picker, confirmation, my bookings/reschedule, provider dashboard. Components: date-picker with available vs blocked slots, booking form, confirmation with add-to-calendar, reschedule/cancel link, empty state "no upcoming appointments". Examples: Calendly, OpenTable, Cal.com, Booksy. Vocabulary: "book now", "appointment", "schedule", "available slots", "time slot", "reschedule", "cancel", "availability". The auto-generated failure mode: booking reduced to a plain contact form with no date/time picker and no confirmation state.
