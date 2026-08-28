import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PatternCard {
  id: string;
  title: string;
  summary: string;
  signals: string[];
  capabilities: string[];
  defaults: string[];
  risks: string[];
  verification: string[];
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

export function retrievePatterns(query: string, limit = 4): PatternRetrievalResult {
  if (!query.trim()) throw new Error("Pattern query must not be empty");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8) {
    throw new Error("Pattern result limit must be between 1 and 8");
  }

  const queryTerms = terms(query);
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
