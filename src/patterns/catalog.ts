import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface WebsiteStrategyView {
  name: string;
  purpose: string;
}

export interface ExampleStartup {
  name: string;
  note: string;
}

const WEBSITE_STRATEGY_PREFIX = "website.strategy.";

function nonEmptyStrings(value: unknown, file: string, field: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Invalid ${field} in ${file}`);
  }
}

export interface PatternCard {
  id: string;
  title: string;
  summary: string;
  signals: string[];
  capabilities: string[];
  defaults: string[];
  risks: string[];
  verification: string[];
  site_goals?: string[];
  typical_views?: WebsiteStrategyView[];
  common_components?: string[];
  example_startups?: ExampleStartup[];
}

interface PatternIndex {
  version: "0.1";
  cards: string[];
}

export interface PatternRetrievalResult {
  query: string;
  selected: Array<{
    card: PatternCard;
    score: number;
    matched_terms: string[];
  }>;
}

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PATTERN_ROOT = path.resolve(SOURCE_DIRECTORY, "../../solution/patterns");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function assertCard(card: PatternCard, file: string): void {
  const arrays = [card.signals, card.capabilities, card.defaults, card.risks, card.verification];
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*@[0-9]+\.[0-9]+\.[0-9]+$/u.test(card.id)) {
    throw new Error(`Invalid pattern ID in ${file}: ${card.id}`);
  }
  if (!card.title || !card.summary || arrays.some((items) => !Array.isArray(items) || items.length === 0)) {
    throw new Error(`Incomplete pattern card: ${file}`);
  }
  if (card.site_goals !== undefined) nonEmptyStrings(card.site_goals, file, "site_goals");
  if (card.common_components !== undefined) nonEmptyStrings(card.common_components, file, "common_components");
  if (card.typical_views !== undefined) {
    if (
      !Array.isArray(card.typical_views) ||
      card.typical_views.length === 0 ||
      card.typical_views.some(
        (view) => typeof view?.name !== "string" || !view.name.trim() || typeof view?.purpose !== "string" || !view.purpose.trim(),
      )
    ) {
      throw new Error(`Invalid typical_views in ${file}`);
    }
  }
  if (card.example_startups !== undefined) {
    if (
      !Array.isArray(card.example_startups) ||
      card.example_startups.some((startup) => typeof startup?.name !== "string" || !startup.name.trim() || typeof startup?.note !== "string" || !startup.note.trim())
    ) {
      throw new Error(`Invalid example_startups in ${file}`);
    }
  }
  if (card.id.startsWith(WEBSITE_STRATEGY_PREFIX)) {
    const required: Array<[unknown, string]> = [
      [card.site_goals, "site_goals"],
      [card.typical_views, "typical_views"],
      [card.common_components, "common_components"],
      [card.example_startups, "example_startups"],
    ];
    if (required.some(([value]) => value === undefined)) {
      throw new Error(`Website strategy card missing website knowledge fields: ${file}`);
    }
    if (card.example_startups !== undefined && card.example_startups.length < 2) {
      throw new Error(`Website strategy card needs at least two example startups: ${file}`);
    }
  }
}

export function loadPatternCatalog(): PatternCard[] {
  const index = readJson<PatternIndex>(path.join(PATTERN_ROOT, "index.json"));
  if (index.version !== "0.1" || !Array.isArray(index.cards)) {
    throw new Error("Unsupported offline pattern index");
  }

  const cards = index.cards.map((relativePath) => {
    const absolutePath = path.resolve(PATTERN_ROOT, relativePath);
    const relative = path.relative(PATTERN_ROOT, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !relative.endsWith(".json")) {
      throw new Error(`Unsafe pattern card path: ${relativePath}`);
    }
    const card = readJson<PatternCard>(absolutePath);
    assertCard(card, relativePath);
    return card;
  });

  const ids = cards.map((card) => card.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate pattern card ID");
  return cards;
}

function terms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/gu) ?? []);
}

// Common prose words that appear in card titles and summaries but carry no
// category signal in an idea. Excluded from query matching so natural-language
// ideas do not surface unrelated cards.
const QUERY_STOPWORDS = new Set([
  "with", "for", "and", "the", "a", "an", "of", "to", "in", "on", "or", "your",
  "you", "their", "from", "into", "that", "this", "is", "are", "be", "by", "at",
  "it", "as", "its", "an",
]);

export function retrievePatterns(query: string, limit = 4): PatternRetrievalResult {
  if (!query.trim()) throw new Error("Pattern query must not be empty");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8) {
    throw new Error("Pattern result limit must be between 1 and 8");
  }

  const queryTerms = terms(query);
  for (const stopword of QUERY_STOPWORDS) queryTerms.delete(stopword);
  const selected = loadPatternCatalog()
    .map((card) => {
      const weightedTerms = [
        ...card.signals.flatMap((signal) => [...terms(signal), ...terms(signal)]),
        ...terms(card.title),
        ...terms(card.summary),
        ...card.capabilities.flatMap((capability) => [...terms(capability)]),
      ];
      const matchedTerms = [...new Set(weightedTerms.filter((term) => queryTerms.has(term)))].sort();
      const score = weightedTerms.reduce((total, term) => total + (queryTerms.has(term) ? 1 : 0), 0);
      return { card, score, matched_terms: matchedTerms };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id))
    .slice(0, limit);

  return { query, selected };
}

export function hasPattern(patternId: string): boolean {
  return loadPatternCatalog().some((card) => card.id === patternId);
}
