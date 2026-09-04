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

  it("keeps website strategy knowledge cards complete and shaped", () => {    const cards = loadPatternCatalog();
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

  it("keeps design family cards complete and shaped", () => {
    const cards = loadPatternCatalog();
    const designCards = cards.filter((card) => card.id.startsWith("website.design."));
    expect(designCards.length).toBeGreaterThanOrEqual(4);
    for (const card of designCards) {
      expect(card.signals.length).toBeGreaterThan(0);
      expect(card.signals.length).toBeLessThanOrEqual(15);
      expect(card.defaults?.length).toBeGreaterThan(0);
      expect(card.example_startups?.length).toBeGreaterThanOrEqual(1);
      expect(card.example_startups).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: expect.any(String), note: expect.any(String) })]),
      );
      expect(card.visual_rules?.length).toBeGreaterThanOrEqual(4);
    }
    const ruleTexts = new Set(designCards.map((card) => JSON.stringify(card.visual_rules)));
    expect(ruleTexts.size).toBe(1);
    const signalWords = new Set(designCards.flatMap((card) => card.signals).flatMap((signal) => signal.split(" ")));
    for (const categoryWord of ["shop", "store", "marketplace", "booking", "saas", "crm", "commerce"]) {
      expect(signalWords.has(categoryWord)).toBe(false);
    }
  });

  it("returns at most one design family card when an idea matches several", () => {
    const selectedIds = retrievePatterns("a dark moody minimal clean habit tracker vibe", 6).selected.map(
      (result) => result.card.id,
    );
    const designIds = selectedIds.filter((id) => id.startsWith("website.design."));
    expect(designIds.length).toBe(1);
  });

  it("keeps the strategy card in top-N alongside at most one design family", () => {
    const selectedIds = retrievePatterns(
      "a warm cozy online storefront selling handmade goods with a product catalogue and cart checkout",
      6,
    ).selected.map((result) => result.card.id);
    expect(selectedIds).toContain("website.strategy.commerce@1.0.0");
    expect(selectedIds.filter((id) => id.startsWith("website.design.")).length).toBeLessThanOrEqual(1);
  });

  it("returns no website cards for unrelated ideas", () => {
    const selectedIds = retrievePatterns("recipe meal planner with weekly grocery lists", 8).selected.map(
      (result) => result.card.id,
    );
    expect(selectedIds.filter((id) => id.startsWith("website."))).toEqual([]);
  });

  it("returns the expected strategy card for a strong-match idea", () => {
    const selectedIds = retrievePatterns("online storefront selling handmade goods with a product catalogue and cart checkout", 6).selected.map(
      (result) => result.card.id,
    );
    expect(selectedIds).toContain("website.strategy.commerce@1.0.0");
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
