## Purpose and Scope

This document catalogs recurring website design patterns for six common startup categories, intended as offline "knowledge cards" for a code-generation agent that turns a one-paragraph startup idea into a small MVP web app. Each card is generic and pattern-level (not brand-specific pixel design), compact (≤7 views, ≤10 components), and includes category-specific vocabulary to support keyword-based idea-to-pattern matching. Findings are drawn from analysis of current reference-startup sites, UX audits, and SaaS/e-commerce conversion research.

### Category: Local / small commerce storefront

Goal priority: sell product (drive add-to-cart and checkout) > build trust/brand affinity > support post-purchase (returns, sizing help) > repeat purchase/loyalty.

Typical views:
- Homepage: showcase bestsellers/new drops, communicate brand value in one scroll
- Category/collection page: let shoppers browse by type (e.g., gender, product type) before narrowing
- Product detail page: enable a purchase decision — photos, price, variant/color selection, reviews, add-to-cart
- Cart/checkout: minimal-distraction flow, no nav during checkout to protect conversion
- About/story page: build brand trust and differentiation
- Help/FAQ (shipping, returns, sizing): reduce pre-purchase and post-purchase friction
- Store locator (optional): bridge to physical retail

Common components: hero banner with primary shop CTA; product grid/card with thumbnail, name, price; variant selector (size/color swatches); sticky add-to-cart button with expandable purchase options; star ratings/reviews; filter and sort sidebar on category pages; cart badge/drawer; trust badges (free shipping, returns policy); newsletter signup; footer with support contact.

Vocabulary/signals: shop, add to cart, checkout, product, collection, size guide, color/variant, in stock, free shipping, return policy, order, cart, buy now, sold out, reviews.

Example startups:
- Allbirds: browse-first storefront that categorizes by gender then product type, keeping information architecture shallow
- Warby Parker: image-led homepage with a single clear CTA hierarchy and playful product-naming/personality on detail pages
- Glossier: content-commerce hybrid embedding product cards directly inside editorial/blog content
- Etsy shops: individual seller storefronts emphasizing handmade/unique positioning within a marketplace shell

Common mistakes: a generic auto-generated commerce site often ships a product list with no dedicated product detail page (no price, images, or variant selection), skips a working cart/checkout state, and omits empty-state and out-of-stock handling that real shoppers expect.

### Category: B2B SaaS with a demo-request sales motion

Goal priority: generate qualified leads and book demos > communicate product value/differentiation to a specific buyer persona > build trust (security/compliance, case studies) > support existing customers (docs, status).

Typical views:
- Homepage: state value proposition and route visitors to "Book a demo" or "Start free trial"
- Product/features page: explain core capabilities mapped to buyer pain points
- Pricing page: show tiers with real (or "starting at") numbers so buyers can self-qualify
- Demo-request/contact-sales page: capture lead info and schedule a meeting
- Customer stories/case studies: provide social proof for a considered purchase
- Security/trust center: address compliance concerns (SOC 2, GDPR) for enterprise buyers
- Docs/resources hub (optional): support technical evaluators

Common components: hero with dual CTA (demo request + self-serve trial); logo wall of customers; pricing table with tiered plans and FAQ beneath it; lead-capture form with meeting scheduler; testimonial/quote cards; security badges (SOC 2, ISO 27001); integrations grid; sticky top-nav CTA; comparison table vs. alternatives.

Vocabulary/signals: demo request, book a demo, free trial, pricing tier, per seat, enterprise, contact sales, integrations, case study, SOC 2, compliance, lead, sales cycle, onboarding, dashboard.

Example startups:
- HubSpot: dedicated demo-scheduling flow combining a meetings link and contact form as the primary conversion path
- Linear: minimalist pricing page with a clean tier comparison and sticky "Get Started" CTA
- Vanta: a public-facing Trust Center that proactively displays compliance posture as a lead-generation and trust-building page
- Salesforce: enterprise-oriented site segmenting by product line with persistent "Watch Demo/Talk to an Expert" CTAs

Common mistakes: a generic SaaS site frequently omits a real pricing page or gates every tier behind "contact us," which measurably increases buyer drop-off, and it often lacks a working lead-capture/demo-booking form or any trust signals (security badges, testimonials) that B2B buyers expect before engaging sales.

### Category: Consumer app with a signup/acquisition funnel

Goal priority: convert visitors to signup/install > communicate the core value in seconds (aha moment) > onboard the new user smoothly > retain via habit loops (streaks, notifications) if freemium.

Typical views:
- Homepage/landing: single-message value prop with a primary "Sign up"/"Get started" CTA
- Download/app-store redirect page: route to iOS/Android or web app
- Signup/onboarding flow: minimal-friction account creation, often with a placement/preference quiz
- Feature/how-it-works page: explain the core loop briefly
- Pricing/upgrade page (for freemium): show free vs. paid tiers
- Login page: return path for existing users
- Empty-state/first-run screen (in-app but relevant to MVP): guide the first action

Common components: hero with app-store badges or single signup form; short animated/video demo of the product; onboarding quiz/wizard; progress indicator during signup; social proof (download counts, ratings); streak/gamification badge (if habit product); freemium comparison table; single-field email capture; mobile app screenshots carousel.

Vocabulary/signals: sign up, get started, download the app, free account, streak, onboarding, install, app store, google play, daily goal, premium/upgrade, login, create account, quiz.

Example startups:
- Duolingo: onboarding-quiz-first funnel that personalizes the experience before requiring signup
- Spotify: homepage split between "Get Spotify Free" and "Premium" CTAs to route casual vs. paying users
- Notion: self-serve freemium motion where the homepage funnels directly into a working signup with no sales gate
- Instagram: near-zero marketing site — homepage exists almost solely to push app-store download or web login

Common mistakes: an auto-generated consumer app site often defaults to a SaaS-style demo-request form instead of a direct signup button, fails to show a lightweight onboarding step, and neglects an empty first-run state — leaving new users at a blank dashboard with no guidance.

### Category: Two-sided marketplace

Goal priority: acquire supply (sellers/hosts/freelancers) and demand (buyers) in balance > enable safe transaction/booking > build trust between strangers via reviews and verification > take a defensible cut of GMV.

Typical views:
- Homepage: dual-sided entry (search bar for buyers, "Become a seller/host" CTA for supply)
- Search/browse/results page: filterable list or map of listings
- Listing/gig detail page: the core trust-and-decision page — photos, price, description, reviews, availability, book/order button
- Seller/host onboarding page: create a listing, set price, add photos
- Checkout/booking confirmation: date/time or quantity selection, payment, confirmation
- Reviews/ratings page or module: bidirectional trust signal
- Messaging/inquiry (optional MVP-lite): buyer-seller contact before or after booking

Common components: search bar with location/date/category filters; listing card (photo, title, price, rating); listing detail gallery with host/seller profile card; star rating and review list; booking/date-picker widget; trust badges (verified, superhost, response rate); price breakdown before checkout; empty-state for "no listings found"; category/service tags.

Vocabulary/signals: listing, book now, host, seller, buyer, gig, request to book, availability, reviews, rating, commission, marketplace, browse, filter, verified, instant book.

Example startups:
- Airbnb: listing page built around trust signals (superhost badge, reviews, host profile) alongside booking mechanics
- Fiverr: gig page structured around gallery, three-tier pricing packages, and FAQ to move buyers from browse to order
- Uber: demand-side homepage optimized for instant matching rather than browsing, contrasting with browse-heavy marketplaces
- Etsy: seller shopfronts nested inside a browsable marketplace, blending storefront and listing patterns

Common mistakes: a generic marketplace build often has only one listing type page shared awkwardly between buyer and seller roles, omits any review/rating display (a core trust mechanic for strangers transacting), and skips the "no results" empty state on search/browse, which is disproportionately common in a thin two-sided market.

### Category: Community / content platform

Goal priority: acquire members/creators > drive content creation and engagement (posting, commenting, upvoting) > retain via notifications/feed > monetize (subscriptions, ads, tips) once critical mass exists.

Typical views:
- Homepage/feed: aggregated content stream, often personalized or chronological
- Individual post/content page: full content plus engagement actions (comment, upvote, share)
- Profile/creator page: bio, published content, follow button
- Community/subreddit-equivalent page: topic-scoped hub with its own feed and rules
- Create/compose page: publish a new post, newsletter issue, or thread
- Subscribe/membership page: paid-tier signup for premium content
- Search/discover page: find communities, creators, or topics

Common components: feed/list of post cards; upvote/like and comment counters; compose/editor box; follow/subscribe button; tag or topic navigation; notification bell; creator profile header with stats; empty-state ("no posts yet — be the first"); paywall/member-only banner.

Vocabulary/signals: post, upvote, comment, follow, subscribe, feed, community, thread, creator, newsletter, publish, member, karma/points, moderator, discover.

Example startups:
- Reddit: topic-scoped communities each with their own feed, rules, and upvote-driven ranking
- Substack: creator-centric model where each publication has its own page, post archive, and paid-subscription gate
- Medium: content-first feed with follow/clap mechanics layered over individual articles
- Discord: server-based communities now extending to public web landing pages to drive external join conversion

Common mistakes: an auto-generated community site frequently builds only a single global feed with no per-community/per-topic scoping, omits basic engagement primitives (upvote, comment, follow), and shows a blank homepage with no seeded or example content, which makes an empty platform feel broken rather than "new."

### Category: Booking / appointment scheduling

Goal priority: convert visitors into a confirmed booking > minimize back-and-forth (show real-time availability) > reduce no-shows (reminders, cancellation policy) > support the provider's calendar management.

Typical views:
- Homepage/service list: what services or providers are offered, with a primary "Book now" CTA
- Service/provider detail page: description, duration, price, and available time slots
- Booking/calendar page: date and time-slot picker, form for customer details
- Confirmation page: booking summary, calendar-add option, cancellation link
- Provider dashboard (MVP-lite): view/manage upcoming appointments
- Account/my bookings page: view or reschedule upcoming appointments

Common components: calendar/date-picker with available vs. blocked slots; service list card (name, duration, price); booking form (name, email, notes); confirmation summary with add-to-calendar button; reminder/notification indicator; cancellation/reschedule link; provider availability toggle; empty-state ("no upcoming appointments").

Vocabulary/signals: book now, appointment, schedule, available slots, time slot, reschedule, cancel, calendar, duration, provider, reminder, confirm booking, walk-in, availability.

Example startups:
- Calendly: pure scheduling-link product where the entire site funnels toward "share your availability" and "book a meeting"
- OpenTable: restaurant booking flow centered on party size, date/time, and instant confirmation
- Cal.com: open-source scheduling alternative emphasizing self-hosted booking pages per user
- Booksy: service-provider booking (salons, spas) combining a service catalog with per-provider time slots

Common mistakes: a generic auto-generated booking app often reduces "book an appointment" to a plain contact form instead of a real date/time picker showing actual availability, has no confirmation state after booking, and lacks any reschedule/cancel path — all of which are core to what makes a booking site functionally different from a generic CRUD form.

## Cross-Category Design Signals for Idea-to-Pattern Matching

The clearest category discriminators are the object being transacted or exchanged (product vs. lead vs. account vs. listing vs. post vs. appointment) and the primary CTA verb (buy vs. book a demo vs. sign up vs. book now vs. post/follow vs. schedule). A generic auto-generated app tends to default to a dashboard-with-CRUD-table pattern regardless of category, which is why category-specific "money pages" (product detail, pricing, listing detail, feed, booking calendar) and category-specific trust/empty-state handling are the highest-leverage additions for making a generated MVP feel like a real startup site rather than an admin panel.

## Design Language Knowledge Card: Color, Contrast, and Visual System

Visual polish is the fastest way for a generated MVP to look like a funded startup rather than a bootstrap CRUD app, and the highest-leverage lever is a disciplined color system, not decoration. The pattern below is deliberately compact so it can be injected as a single knowledge card at near-zero token cost while still encoding what separates a "designed" site from a generic default one.

### Core principle: one dominant brand color, near-black/near-white neutrals, disciplined accents

Across both Nordic and global reference startups, the winning formula is consistently: one saturated signature brand color used sparingly for identity and primary CTAs, paired with an off-black/off-white neutral pair (never pure #000000/#FFFFFF) for 90%+ of the UI, plus at most one or two secondary/accent colors reserved for backgrounds or highlights. Klarna's system is the clearest example: Klarna Pink (#FFA8CD, refreshed to #FFB3C7) is the sole signature color, explicitly banned from large-body typography and from gradients or unapproved combinations, and is always paired with Klarna Black and an off-white background rather than pure white. This "one hero color + neutral scaffold" rule is the single most copyable takeaway: it reads as intentional and premium, while multiple competing saturated colors reads as unstyled or template-default.

### Nordic/Swedish reference systems

Lovable (Swedish-founded AI app-builder) uses a warm, editorial neutral palette rather than a bright brand color: a cream/parchment background (#f7f4ed, close relative #FCFBF8), near-black charcoal text (#1c1c1c) rather than pure black, and a single near-black accent (#1E1E1E) for interactive elements — no competing hues at all. Its depth system is notable and cheap to replicate: instead of a traditional gray scale, every neutral shade in the UI is the same base charcoal (#1c1c1c) rendered at different opacities (4%, 40%, 82%, 83%, 100%), which guarantees perfect tonal harmony without a designer manually picking multiple gray hex values — borders use a warm #eceae4 for subtle divisions and rgba(28,28,28,0.4) for stronger interactive boundaries. Neko Health (Swedish/Nordic med-tech scanning startup) takes the opposite approach: a warm, optimistic secondary palette (yellow, beige, brown, green) layered over clinical monochrome, used specifically to soften a health-tech product and signal trust and calm rather than sterility. Mullvad VPN (Swedish privacy company) keeps a restrained primary blue/dark-blue pair (#294D73, #192E45) with green and red reserved strictly as functional status colors (connected/disconnected), illustrating the pattern of using saturated color only for state signaling in a security-oriented product. Spotify anchors its entire system on a single signature green against near-black backgrounds, reinforcing that dark-mode-first consumer apps benefit from one saturated accent doing all the identity work against a near-black canvas.

### Contrast and accessibility rules (compact, injectable)

Regardless of category, the WCAG 2.1/2.2 Level AA baseline is the practical floor for any generated site: normal body text needs at least a 4.5:1 contrast ratio against its background, large text (18pt+/24px+, or 14pt+/18.5px+ bold) only needs 3:1, and non-text UI elements (buttons, form borders, icons) need at least 3:1 against adjacent colors. The contrast ratio is computed as (L1 + 0.05) / (L2 + 0.05) using relative luminance, ranges from 1:1 (no contrast) to 21:1 (pure black on white), and must not be rounded up to pass a threshold. A pragmatic generation rule: never place brand-accent-colored text directly on a busy or mid-tone background, always verify hero-CTA-button-text-on-button-background contrast explicitly, and default body copy to near-black-on-near-white or near-white-on-near-black rather than mid-gray-on-white, which frequently fails 4.5:1 at typical 14-16px sizes.

### Compact design-language card (proposed injectable format)

```
### Design language: <category/vibe>
Palette: 1 signature brand color (sparingly, CTAs/accents only) + near-black/near-white neutral pair (not pure #000/#FFF) + optional 1-2 secondary tones for backgrounds only
Contrast: body text >=4.5:1, large text/headings >=3:1, buttons/borders >=3:1 vs adjacent color
Neutral system: derive all grays from one base hue at varying opacity (e.g. 4%, 40%, 82%, 100%) instead of picking separate gray hex values
Rules: never use brand accent for large body text; never combine 3+ saturated hues; avoid gradients unless brand explicitly uses them; dark-mode products anchor on one saturated accent vs near-black canvas
Reference: <startup>: <one-line color takeaway>
```

This card format costs roughly 60-90 tokens fully populated, far cheaper than describing a full brand book, while encoding the two things that most visibly separate a "generic AI app" look from a "real startup" look: color discipline (one hero hue, disciplined neutrals) and contrast discipline (WCAG AA compliance by default, verified on every CTA).
