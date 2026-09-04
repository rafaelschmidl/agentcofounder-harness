# Startup website design-pattern research brief (for Perplexity)

Copy this whole document into Perplexity (or any research AI with web access). Answer it thoroughly — the output will be merged into `docs/startup-website-research.md` in our repository, which feeds a knowledge library used by our code-generation agent.

---

## 1. Who is asking, and why (hackathon context)

We are competing in the **AgentCofounder hackathon** (Stockholm AI / Nordic Tech Week). Our system is an automated "agent cofounder": a human gives it a raw one-paragraph startup idea, and our harness turns it into a small but working web-app MVP (a React single-page app) — fully autonomously, in one run. The language model that does this is GLM-5.2 via the Berget provider, and **our harness has no internet access during generation**. That constraint is why we must pre-curate domain knowledge into local files ("knowledge cards") that our offline pattern catalog can retrieve and inject into the model's context.

The run is judged on two axes:

- **Readiness/quality** of the generated app: task completion, usability/UX (empty states, validation feedback, sensible information architecture), persistence, robustness, maintainability.
- **Efficiency**: a weighted-token formula (input + 3× output + 0.1× cache-read). Every token we put into the model's context costs us score, so our knowledge must be **dense and curated, not encyclopedic**.

The hidden evaluation idea is "similar in structure, difficulty, application kind, and scale" to the visible examples (a book-lending tracker, a small commerce checkout, a SaaS feedback workflow) — i.e., small-scale MVP websites. We want the generated app's structure to *feel like a real startup website from its category* rather than a generic CRUD dashboard.

## 2. What we want: common startup categories and their website design patterns

We are building a library of **startup website archetypes**: for the most common types of startups, what is that website trying to achieve, what views/pages does it typically have, and which components recur? The deliverable is per-category knowledge like:

- **Site goals** — why the site exists (e.g., acquire users/signups, sell product, book a demo, onboard users, facilitate a transaction, grow a community).
- **Typical views/pages** — the standard page inventory, each with its purpose (e.g., "product detail page — make purchase decision easy; shows price, photos, reviews, add-to-cart").
- **Common components** — recurring UI building blocks (e.g., hero with primary CTA, pricing table with tiers, testimonial band, signup form, cart badge, star ratings, filter sidebar, empty-state message).
- **Example startups** — 3–4 well-known references per category, each with a one-line note on what its site exemplifies.

Prioritize the design patterns of **small-scale, MVP-like websites in each category** — what a competent first version would include — not enterprise-scale site maps.

## 3. The categories we want analyzed

For **each category below**, analyze 3–4 well-known reference startups' current websites and report: (a) site goals in priority order, (b) the typical/possibly-visible views & pages with one-line purposes, (c) the recurring components with what each is for, (d) one-line notes per example startup, (e) the distinctive vocabulary/nouns this category uses for its views (we match ideas to cards by keywords, so category-specific terms matter), and (f) common mistakes a generic auto-generated site makes for this category (what our generated app should NOT do).

1. **Local / small commerce storefront** (sell physical or digital products online)
   - Reference examples to consider: Shopify-powered D2C brands (e.g., Allbirds), Etsy shops, Glossier, Warby Parker.
2. **B2B SaaS with a demo-request sales motion** (long sales cycle; the site's job is to generate leads/book demos)
   - Reference examples to consider: Salesforce, HubSpot, Slack (marketing site), Linear, Vanta.
3. **Consumer app with a signup/acquisition funnel** (the product IS the app; site funnels visitors to install/signup)
   - Reference examples to consider: Spotify, Duolingo, Instagram, Notion (freemium self-serve motion).
4. **Two-sided marketplace** (buyers and sellers/meet sides must be acquired and transact)
   - Reference examples to consider: Airbnb, Uber, Etsy's marketplace side, Fiverr.
5. **Community / content platform** (acquire members/creators; publish and engage with content)
   - Reference examples to consider: Reddit, Substack, Medium, Discord.
6. *Optional — any other clearly distinct startup-category website archetype you think we are missing* (e.g., booking/appointments, fintech/dashboard app, education/course platform, internal-tool builder). Only include it if its site goals/views/components are genuinely distinct from the five above.

## 4. Constraints on the answer

- Be **generic and pattern-level**: describe recurring structures, not specific brands' pixel designs.
- Keep each category's answer compact — our final format per view/component is one line each. Aim for ≤ 7 typical views and ≤ 10 components per category.
- For vocab/signals: give us 10–15 distinct, category-specific keywords (single words or short phrases like "demo request", "cart", "upvote", "listing") that would appear in a founder's idea text for this category but rarely in other categories.
- For "common mistakes": think of what an auto-generated generic dashboard app gets wrong for this category (e.g., a commerce site with no product page; a SaaS demo site with no pricing; a marketplace with no trust signals).

## 5. Output format requested

One section per category, each structured exactly like:

```
### Category: <name>
Goal priority: <goal 1> > <goal 2> > ...
Typical views:
- <view name>: <purpose, one line>
- ...
Common components:
- <component>: <what it is for, a few words>
- ...
Vocabulary/signals: <comma-separated keywords>
Example startups:
- <name>: <what its site exemplifies, one line>
Common mistakes: <one or two sentences>
```
