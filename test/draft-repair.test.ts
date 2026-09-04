import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replaceDraftValues, submitProductSpecDraftCandidate } from "../src/product-spec/submit.js";
import { segmentIdea } from "../src/product-spec/fragments.js";
import { SAMPLE_IDEA, validProductSpec } from "./fixtures/product-spec.js";

describe("retained ProductSpec repair", () => {
  it("accepts a targeted correction only after the full repaired specification validates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-repair-"));
    try {
      const spec = validProductSpec();
      const { source_idea_hash: _hash, source_fragments: _fragments, ...semantic } = structuredClone(spec);
      const draft = {
        ...semantic,
        requirements: semantic.requirements.map((requirement) => ({
          ...requirement,
          source_refs: requirement.source_refs.map((reference) => reference.fragment_id),
        })),
        conflicts: [],
      };
      const expectedActor = draft.acceptance_journeys[0]!.actor_id;
      draft.acceptance_journeys[0]!.actor_id = "missing_actor";
      const output = join(directory, "idea_spec.json");
      const submit = (value: unknown) => submitProductSpecDraftCandidate(JSON.stringify(value), SAMPLE_IDEA, segmentIdea(SAMPLE_IDEA), output);
      expect((await submit(draft)).accepted).toBe(false);

      const stillInvalid = replaceDraftValues(draft, [{ path: "/product/summary", value: "A corrected title" }]);
      expect((await submit(stillInvalid)).accepted).toBe(false);
      const repaired = replaceDraftValues(draft, [{ path: "/acceptance_journeys/0/actor_id", value: expectedActor }]);
      expect((await submit(repaired)).accepted).toBe(true);
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(spec);
      expect(draft.acceptance_journeys[0]!.actor_id).toBe("missing_actor");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects nonexistent or unsafe paths atomically and requires a retained draft", () => {
    const original = { nested: { value: 1 }, list: ["a"] };
    expect(() => replaceDraftValues(undefined, [{ path: "/x", value: 1 }])).toThrow("No draft");
    for (const path of ["", "/nested/missing", "/list/01", "/list/-", "/__proto__/x", "/nested/~2"]) {
      expect(() => replaceDraftValues(original, [
        { path: "/nested/value", value: 2 }, { path, value: 3 },
      ])).toThrow();
      expect(original.nested.value).toBe(1);
    }
    expect(replaceDraftValues({ "a/b": { "~value": 1 } }, [{ path: "/a~1b/~0value", value: 2 }]))
      .toEqual({ "a/b": { "~value": 2 } });
  });
});
