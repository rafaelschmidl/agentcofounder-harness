import { describe, expect, it } from "vitest";
import { expandProductSpecDraft } from "../src/product-spec/draft.js";
import { segmentIdea } from "../src/product-spec/fragments.js";
import { replaceDraftValues } from "../src/product-spec/submit.js";
import type { ProductSpec } from "../src/product-spec/types.js";
import { validateProductSpec } from "../src/product-spec/validate.js";
import { SAMPLE_IDEA, validProductSpec } from "./fixtures/product-spec.js";

function compactDraft(spec = validProductSpec()) {
  const { version: _version, source_idea_hash: _hash, source_fragments: _fragments, ...semantic } = structuredClone(spec);
  return {
    ...semantic,
    fragment_disposition: semantic.fragment_disposition.map(({ requirement_ids: _ids, ...disposition }) => disposition),
    requirements: semantic.requirements.map(({ disposition: _disposition, journey_ids: _journeys, ...requirement }) => ({
      ...requirement,
      source_refs: requirement.source_refs.map((reference) => reference.fragment_id),
    })),
    conflicts: semantic.conflicts.map((conflict) => ({
      ...conflict,
      source_refs: conflict.source_refs.map((reference) => reference.fragment_id),
    })),
  };
}

function expandAndValidate(draft: unknown) {
  const expansion = expandProductSpecDraft(draft, SAMPLE_IDEA, segmentIdea(SAMPLE_IDEA));
  expect(expansion.errors).toEqual([]);
  return validateProductSpec(expansion.candidate, SAMPLE_IDEA, segmentIdea(SAMPLE_IDEA));
}

describe("omitted deterministic ProductSpec draft fields", () => {
  it("reconstructs the complete canonical spec without changing the retained draft", () => {
    const spec = validProductSpec();
    spec.product.experience = {
      name: "Notebook",
      visual_direction: "Warm paper and ink, with readable type.",
      composition: "A focused note list beside its editor.",
      interaction_priorities: ["Find the latest note quickly."],
    };
    const draft = compactDraft(spec);
    const retained = structuredClone(draft);
    expect(expandAndValidate(draft)).toMatchObject({ valid: true, spec });
    expect(draft).toEqual(retained);
  });

  it.each(["IMPLIED", "PROPOSED", "EXCLUDED"] as const)("derives %s disposition and the correct journey membership", (provenance) => {
    const spec = validProductSpec();
    const requirement = spec.requirements[0]!;
    requirement.provenance = provenance;
    if (provenance !== "IMPLIED") {
      requirement.disposition = provenance === "PROPOSED" ? "PROPOSE" : "EXCLUDE";
      requirement.journey_ids = [];
      spec.acceptance_journeys = spec.acceptance_journeys.filter((journey) => journey.id !== "journey_add_note");
    }
    expect(expandAndValidate(compactDraft(spec))).toMatchObject({ valid: true, spec });
  });

  it.each([
    ["version", "9.9"],
    ["version", null],
    ["disposition", "PROPOSE"],
    ["disposition", null],
    ["journey_ids", null],
    ["journey_ids", "journey_add_note"],
    ["journey_ids", [42]],
    ["journey_ids", ["missing_journey"]],
    ["provenance", "UNKNOWN"],
  ])("does not normalize away explicit invalid %s = %j", (field, value) => {
    const draft = compactDraft();
    const target = (field === "version" ? draft : draft.requirements[0]) as Record<string, unknown>;
    target[field as string] = value;
    const result = expandAndValidate(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(field === "journey_ids" ? /journey/u : new RegExp(String(field), "u"));
  });

  it.each([{ value: null }, { value: [] }, { value: [42] }, { value: ["unknown_requirement"] }])("preserves invalid authoritative journey references $value", ({ value }) => {
    const draft = compactDraft();
    (draft.acceptance_journeys[0] as unknown as Record<string, unknown>).requirement_ids = value;
    expect(expandAndValidate(draft).valid).toBe(false);
  });

  it("rejects missing coverage and repairs the authoritative journey mapping without adding derived fields", () => {
    const draft = compactDraft();
    draft.acceptance_journeys[0]!.requirement_ids = ["req_validation"];
    const rejected = expandAndValidate(draft);
    expect(rejected.valid).toBe(false);
    expect(rejected.errors.join(" ")).toContain("implemented requirement req_notes must map to an acceptance journey");
    const repaired = replaceDraftValues(draft, [{
      path: "/acceptance_journeys/0/requirement_ids",
      value: ["req_notes"],
    }]);
    expect(expandAndValidate(repaired)).toMatchObject({ valid: true, spec: validProductSpec() });
    expect(draft.requirements[0]).not.toHaveProperty("journey_ids");
  });

  it("retains provenance and non-implemented journey validation", () => {
    const draft = compactDraft();
    draft.requirements[0]!.provenance = "DEFAULT";
    expect(expandAndValidate(draft).errors.join(" ")).toContain("must not claim source_refs");
    draft.requirements[0]!.provenance = "EXCLUDED";
    expect(expandAndValidate(draft).errors.join(" ")).toContain("non-implemented requirement");
  });

  it("keeps canonical validation strict about omitted fields", () => {
    const spec = validProductSpec();
    delete (spec as Partial<ProductSpec>).version;
    expect(validateProductSpec(spec, SAMPLE_IDEA).valid).toBe(false);
  });
});
