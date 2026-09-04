import { describe, expect, it } from "vitest";
import { builderExecutionContext } from "../src/builder.js";
import { compileProductSpec } from "../src/build-plan/compile.js";
import { validProductSpec } from "./fixtures/product-spec.js";

describe("builder execution context", () => {
  it("preserves product meaning and negative scope without repeating source evidence", () => {
    const spec = validProductSpec();
    spec.exclusions = ["No authentication"];
    const before = structuredClone(spec);
    const plan = compileProductSpec(spec);
    const context = builderExecutionContext(spec, plan);
    expect(context.requirements.map(({ id, description, disposition }) => ({ id, description, disposition })))
      .toEqual(spec.requirements.map(({ id, description, disposition }) => ({ id, description, disposition })));
    expect(context.acceptance_journeys).toEqual(spec.acceptance_journeys);
    expect(context.entities).toEqual(spec.entities);
    expect(context.workflows).toEqual(spec.workflows);
    expect(context.exclusions).toEqual(["No authentication"]);
    expect(context.build.verification_obligations).toEqual(plan.verification_obligations);
    expect(context.build.owned_paths).toEqual(plan.file_ownership.filter((entry) => entry.owner === "AGENT").map((entry) => entry.path));
    expect(context).not.toHaveProperty("source_fragments");
    expect(context.requirements.every((requirement) => !("source_refs" in requirement))).toBe(true);
    expect(spec).toEqual(before);
    expect(JSON.stringify(context).length).toBeLessThan(JSON.stringify({ spec, plan }).length);
  });
});
