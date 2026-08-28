import { describe, expect, it } from "vitest";
import { hashIdea, segmentIdea } from "../src/product-spec/fragments.js";

describe("source idea segmentation", () => {
  it("preserves exact offsets and ignores surrounding whitespace", () => {
    const idea = "  Add books.  Track loans!\n\nKeep it local?  ";
    const fragments = segmentIdea(idea);

    expect(fragments.map((fragment) => fragment.text)).toEqual([
      "Add books.",
      "Track loans!",
      "Keep it local?",
    ]);
    for (const fragment of fragments) {
      expect(idea.slice(fragment.start, fragment.end)).toBe(fragment.text);
    }
  });

  it("uses content-derived IDs that remain stable when another sentence is inserted", () => {
    const original = segmentIdea("Add books. Track loans.");
    const changed = segmentIdea("Welcome. Add books. Track loans.");

    expect(changed[1]?.id).toBe(original[0]?.id);
    expect(changed[2]?.id).toBe(original[1]?.id);
  });

  it("hashes the unmodified source deterministically", () => {
    expect(hashIdea("same")).toBe(hashIdea("same"));
    expect(hashIdea("same")).not.toBe(hashIdea("same "));
    expect(hashIdea("same")).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
