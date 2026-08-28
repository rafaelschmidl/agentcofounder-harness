import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendPatternRetrievalAudit } from "../src/patterns/audit.js";
import { loadPatternCatalog, retrievePatterns } from "../src/patterns/catalog.js";

describe("offline pattern catalogue", () => {
  it("loads unique, versioned, complete cards", () => {
    const cards = loadPatternCatalog();
    expect(cards).toHaveLength(8);
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
});
