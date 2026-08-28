import { describe, expect, it } from "vitest";
import { validateProductSpec } from "../src/product-spec/validate.js";
import { SAMPLE_IDEA, validProductSpec } from "./fixtures/product-spec.js";

describe("ProductSpec v0.1 validation", () => {
  it("accepts a schema-valid, fully traced specification", () => {
    const result = validateProductSpec(validProductSpec(), SAMPLE_IDEA);
    expect(result).toEqual({ valid: true, errors: [], spec: validProductSpec() });
  });

  it("rejects schema drift and unknown fields", () => {
    const candidate = { ...validProductSpec(), surprise: true };
    const result = validateProductSpec(candidate, SAMPLE_IDEA);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("additional properties");
  });

  it("rejects changed source offsets and incomplete fragment disposition", () => {
    const candidate = validProductSpec();
    const requirement = candidate.requirements[0];
    if (!requirement) throw new Error("missing test requirement");
    const reference = requirement.source_refs[0];
    if (!reference) throw new Error("missing test source reference");
    reference.end -= 1;
    const disposition = candidate.fragment_disposition[0];
    if (!disposition) throw new Error("missing test fragment disposition");
    candidate.fragment_disposition.push({ ...disposition });

    const result = validateProductSpec(candidate, SAMPLE_IDEA);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("quote does not match the exact source range");
    expect(result.errors.join("\n")).toContain("must have exactly one disposition");
  });

  it("keeps proposed and excluded features out of implementation journeys", () => {
    const candidate = validProductSpec();
    candidate.requirements.push({
      id: "req_login",
      title: "Add login",
      description: "Potential future login.",
      kind: "SCOPE",
      provenance: "PROPOSED",
      disposition: "IMPLEMENT",
      source_refs: [],
      journey_ids: ["journey_add_note"],
    });

    const result = validateProductSpec(candidate, SAMPLE_IDEA);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("PROPOSED requirement req_login must use PROPOSE disposition");
  });

  it("requires bidirectional journey mappings for implemented behavior", () => {
    const candidate = validProductSpec();
    const journey = candidate.acceptance_journeys[0];
    if (!journey) throw new Error("missing test journey");
    journey.requirement_ids = ["req_validation"];

    const result = validateProductSpec(candidate, SAMPLE_IDEA);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("mappings disagree");
  });

  it("rejects pattern IDs that were not bundled locally", () => {
    const candidate = validProductSpec();
    candidate.selected_patterns.push("domain.unknown@1.0.0");
    const result = validateProductSpec(candidate, SAMPLE_IDEA);
    expect(result.errors).toContain("selected_patterns references unknown pattern domain.unknown@1.0.0");
  });
});
