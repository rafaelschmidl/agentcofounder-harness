import { createHash } from "node:crypto";
import type { SourceFragment } from "./types.js";

export function hashIdea(idea: string): string {
  return `sha256:${createHash("sha256").update(idea, "utf8").digest("hex")}`;
}

function fragmentId(text: string, occurrence: number): string {
  const digest = createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
  return `fragment-${digest}-${occurrence}`;
}

/**
 * Splits non-empty paragraphs into sentence-sized fragments while preserving
 * exact offsets into the unmodified source idea. IDs are content-derived so
 * inserting an unrelated earlier sentence does not rename later fragments.
 */
export function segmentIdea(idea: string): SourceFragment[] {
  const fragments: SourceFragment[] = [];
  const occurrences = new Map<string, number>();
  const paragraphPattern = /\S(?:[^\r\n]*\S)?/gu;

  for (const paragraphMatch of idea.matchAll(paragraphPattern)) {
    const paragraph = paragraphMatch[0];
    const paragraphStart = paragraphMatch.index;
    const sentencePattern = /[^.!?]+(?:[.!?]+(?=\s|$)|$)/gu;

    for (const sentenceMatch of paragraph.matchAll(sentencePattern)) {
      const untrimmed = sentenceMatch[0];
      const leadingWhitespace = untrimmed.length - untrimmed.trimStart().length;
      const trailingWhitespace = untrimmed.length - untrimmed.trimEnd().length;
      const start = paragraphStart + sentenceMatch.index + leadingWhitespace;
      const end = paragraphStart + sentenceMatch.index + untrimmed.length - trailingWhitespace;
      if (end <= start) continue;

      const text = idea.slice(start, end);
      const nextOccurrence = (occurrences.get(text) ?? 0) + 1;
      occurrences.set(text, nextOccurrence);
      fragments.push({ id: fragmentId(text, nextOccurrence), start, end, text });
    }
  }

  return fragments;
}
