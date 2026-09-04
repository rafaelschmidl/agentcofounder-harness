import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendPatternRetrievalAudit } from "../src/patterns/audit.js";
import { loadPatternCatalog, retrievePatterns } from "../src/patterns/catalog.js";

describe("offline pattern catalogue", () => {
  it("loads unique, versioned, complete cards", () => {
    const cards = loadPatternCatalog();
    expect(cards.length).toBeGreaterThanOrEqual(8);
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
    expect(cards.every((card) => card.id.includes("@1.0.0"))).toBe(true);
  });

  it("retrieves commerce transaction patterns deterministically", () => {
    const query = "shop product stock cart checkout payment declined order total";
    const first = retrievePatterns(query, 4);
    const second = retrievePatterns(query, 4);

    expect(second).toEqual(first);
    expect(first.selected.map((result) => result.card.id)).toContain("domain.commerce@1.0.0");
    expect(first.selected.map((result) => result.card.id)).toContain("checkout.stubbed@1.0.0");
    expect(first.selected.every((result) => result.score > 0 && result.matched_terms.length > 0)).toBe(true);
  });

  it("returns no cards when the query has no catalogue signal", () => {
    expect(retrievePatterns("astrophysics telescope", 3).selected).toEqual([]);
  });

  it("keeps website strategy knowledge cards complete and shaped", () => {
    const cards = loadPatternCatalog();
    const websiteCards = cards.filter((card) => card.id.startsWith("website.strategy."));
    expect(websiteCards.length).toBeGreaterThanOrEqual(5);
    for (const card of websiteCards) {
      expect(card.site_goals).toEqual(expect.arrayContaining([expect.any(String)]));
      expect(card.typical_views?.length).toBeGreaterThanOrEqual(1);
      expect(card.typical_views).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: expect.any(String), purpose: expect.any(String) })]),
      );
      expect(card.common_components?.length).toBeGreaterThan(0);
      expect(card.example_startups?.length).toBeGreaterThanOrEqual(2);
      expect(card.example_startups).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: expect.any(String), note: expect.any(String) })]),
      );
      expect(card.signals.length).toBeLessThanOrEqual(15);
    }
  });

  it("covers the mandatory goal types and categories", () => {
    const cards = loadPatternCatalog();
    const websiteCards = cards.filter((card) => card.id.startsWith("website.strategy."));
    const goals = websiteCards.flatMap((card) => card.site_goals ?? []);
    const lowerGoals = goals.map((goal) => goal.toLowerCase());
    expect(lowerGoals.some((goal) => /signup|acquire users|user acquisition|acquisition/.test(goal))).toBe(true);
    expect(lowerGoals.some((goal) => /sell|product|checkout|purchase/.test(goal))).toBe(true);
    expect(lowerGoals.some((goal) => /demo|lead/.test(goal))).toBe(true);
    const categories = new Set(websiteCards.map((card) => card.id.replace(/^website\.strategy\./u, "").replace(/@\d.*$/u, "")));
    expect(categories.has("commerce")).toBe(true);
    expect(categories.has("saas-demo")).toBe(true);
    expect(categories.has("consumer-app")).toBe(true);
    expect(categories.has("marketplace")).toBe(true);
    expect(categories.has("community-content")).toBe(true);
  });

  it("surfaces website strategy cards for matching category ideas", () => {
    const commerceIdea = "online storefront selling handmade goods with a product catalogue and cart checkout";
    expect(retrievePatterns(commerceIdea, 6).selected.map((result) => result.card.id)).toContain("website.strategy.commerce@1.0.0");

    const communityIdea = "community platform where members publish articles and discussions";
    expect(retrievePatterns(communityIdea, 6).selected.map((result) => result.card.id)).toContain("website.strategy.community-content@1.0.0");

    const marketplaceIdea = "marketplace for rental listings where buyers contact hosts";
    expect(retrievePatterns(marketplaceIdea, 6).selected.map((result) => result.card.id)).toContain("website.strategy.marketplace@1.0.0");
  });

  it("does not force website strategy cards onto unrelated ideas", () => {
    const selected = retrievePatterns("recipe meal planner with weekly grocery lists", 6).selected;
    expect(selected.map((result) => result.card.id).filter((id) => id.startsWith("website.strategy."))).toEqual([]);
  });

  it.each([
    "book", "now", "return", "account", "daily", "now book", "policy then return", "booklet now",
    "Keep a supplier address book, contact names and account notes",
    "Track borrowed equipment and return dates",
    "Plan daily tasks and mark completed items",
  ])("does not treat fragments of website signal phrases as complete category evidence: %s", (query) => {
    const websites = retrievePatterns(query, 8).selected.filter(({ card }) => card.id.startsWith("website.strategy."));
    expect(websites).toEqual([]);
  });

  it.each([
    ["BOOK-now", "booking-appointments"],
    ["RETURN-policy", "commerce"],
    ["book a DEMO", "saas-demo"],
    ["daily goal", "consumer-app"],
    ["peer-to-peer", "marketplace"],
    ["community members publish articles", "community-content"],
  ])("still retrieves a valid website category from complete normalized signals: %s", (query, category) => {
    const selected = retrievePatterns(query, 8).selected;
    expect(selected.map(({ card }) => card.id)).toContain(`website.strategy.${category}@1.0.0`);
  });

  it("keeps independent single-word evidence while refusing a separated multiword bonus", () => {
    const result = retrievePatterns("book the demo", 8).selected.find(({ card }) => card.id === "website.strategy.saas-demo@1.0.0");
    expect(result).toBeDefined(); // "demo" is also an explicit, valid standalone signal.
    expect(result?.matched_terms).toContain("demo");
    expect(result?.matched_terms).not.toContain("book");
  });

  it("retains the public lending prompt's mechanical cards without new commerce or booking contamination", () => {
    const query = "My family is always borrowing books off my shelves and I never remember who has what. I'd like something simple where I can put in each book, the title, who wrote it, and roughly what kind of book it is, like a novel or a cookbook or a reference thing. When someone borrows one I want to note down their name, and when it comes back I want to clear that off. Mostly I just want to open it up and see everything I own in one list, and be able to pick out just the ones that are currently out with someone. It'd be nice to see how many are lent out right now. If I add a book by mistake I need to be able to fix it or take it off the list. It's just me using it on my own computer.";
    const selected = retrievePatterns(query, 4).selected.map(({ card }) => card.id);
    expect(selected).toContain("crud.collection@1.0.0");
    expect(selected).toContain("metrics.derived@1.0.0");
    expect(selected).toContain("persistence.local@1.0.0");
    expect(selected).not.toContain("website.strategy.commerce@1.0.0");
    expect(selected).not.toContain("website.strategy.booking-appointments@1.0.0");
  });

  it("preserves mechanical-card scores for an existing commerce query", () => {
    const selected = retrievePatterns("shop product stock cart checkout payment declined order total", 8).selected;
    expect(selected.find(({ card }) => card.id === "domain.commerce@1.0.0")).toMatchObject({ score: 18 });
    expect(selected.find(({ card }) => card.id === "checkout.stubbed@1.0.0")).toMatchObject({ score: 14 });
    expect(selected.find(({ card }) => card.id === "transaction.atomic@1.0.0")).toMatchObject({ score: 8 });
  });

  it("does not crowd mechanical cards out of their own retrieval", () => {
    const mechanicalIdea = "shop product stock cart checkout payment declined order total";
    const selected = retrievePatterns(mechanicalIdea, 8).selected.map((result) => result.card.id);
    expect(selected).toContain("domain.commerce@1.0.0");
    expect(selected).toContain("checkout.stubbed@1.0.0");
    expect(selected).toContain("website.strategy.commerce@1.0.0");
  });

  it("keeps the default top-N result bound intact", () => {
    const result = retrievePatterns("shop product stock cart checkout payment declined order total", 4);
    expect(result.selected.length).toBeLessThanOrEqual(4);
  });

  it("records retrieved cards as runner-readable JSONL evidence", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pattern-audit-"));
    try {
      const file = path.join(directory, "patterns.jsonl");
      const result = retrievePatterns("feedback priority workflow shipped", 3);
      const event = await appendPatternRetrievalAudit(file, result);
      const recorded = JSON.parse((await readFile(file, "utf8")).trim()) as unknown;
      expect(recorded).toEqual(event);
      expect(event.selected.map((item) => item.card.id)).toContain("domain.saas-operations@1.0.0");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("records website strategy knowledge selection in the audit trail", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pattern-audit-"));
    try {
      const file = path.join(directory, "patterns.jsonl");
      const result = retrievePatterns("online storefront selling handmade goods with a product catalogue and cart checkout", 6);
      const event = await appendPatternRetrievalAudit(file, result);
      const recorded = JSON.parse((await readFile(file, "utf8")).trim()) as unknown;
      expect(recorded).toEqual(event);
      expect(event.selected.map((item) => item.card.id)).toContain("website.strategy.commerce@1.0.0");
      expect(event.selected.find((item) => item.card.id === "website.strategy.commerce@1.0.0")).toMatchObject({
        matched_terms: expect.arrayContaining(["storefront"]),
        card: expect.objectContaining({ site_goals: expect.any(Array), typical_views: expect.any(Array) }),
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
