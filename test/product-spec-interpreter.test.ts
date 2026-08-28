import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInterpreterPiArguments } from "../src/product-spec/interpreter.js";
import { segmentIdea } from "../src/product-spec/fragments.js";
import { submitProductSpecCandidate, submitProductSpecDraftCandidate } from "../src/product-spec/submit.js";
import { SAMPLE_IDEA, validProductSpec } from "./fixtures/product-spec.js";
import { productSpecDraftSchema } from "../solution/extensions/product-spec-interpreter.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("ProductSpec interpreter boundary", () => {
  it("derives a compact tool schema with deterministic source fields removed", () => {
    const schema = productSpecDraftSchema() as {
      required: string[];
      properties: Record<string, unknown>;
      $defs: { sourceReference: Record<string, unknown>; fragmentDisposition: { required: string[] } };
    };
    expect(schema.required).not.toContain("source_idea_hash");
    expect(schema.required).not.toContain("source_fragments");
    expect(schema.properties).not.toHaveProperty("source_idea_hash");
    expect(schema.properties).not.toHaveProperty("source_fragments");
    expect(schema.$defs.sourceReference.type).toBe("string");
    expect(schema.$defs.fragmentDisposition.required).not.toContain("requirement_ids");
  });

  it("enables only offline retrieval and submission tools", () => {
    const previous = {
      provider: process.env.CHALLENGE_PROVIDER,
      model: process.env.CHALLENGE_MODEL,
      thinking: process.env.CHALLENGE_THINKING,
      interpreterThinking: process.env.CHALLENGE_INTERPRETER_THINKING,
    };
    delete process.env.CHALLENGE_PROVIDER;
    delete process.env.CHALLENGE_MODEL;
    delete process.env.CHALLENGE_THINKING;
    delete process.env.CHALLENGE_INTERPRETER_THINKING;
    try {
      const args = buildInterpreterPiArguments(
        SAMPLE_IDEA,
        segmentIdea(SAMPLE_IDEA),
        "Interpret product scope.",
        "/tmp/system-v0-run",
      );
      expect(args).toContain("--print");
      expect(args).toContain("--offline");
      expect(args).toContain("--no-builtin-tools");
      expect(args[args.indexOf("--tools") + 1]).toBe("retrieve_patterns,submit_product_spec");
      expect(args[args.indexOf("--provider") + 1]).toBe("berget");
      expect(args[args.indexOf("--model") + 1]).toBe("berget/zai-org/GLM-5.2");
      expect(args.join(" ")).toContain("@bergetai/pi-provider");
      expect(args[args.indexOf("--thinking") + 1]).toBe("off");
      expect(args.join(" ")).not.toContain("protected-paths.ts");
    } finally {
      if (previous.provider === undefined) delete process.env.CHALLENGE_PROVIDER;
      else process.env.CHALLENGE_PROVIDER = previous.provider;
      if (previous.model === undefined) delete process.env.CHALLENGE_MODEL;
      else process.env.CHALLENGE_MODEL = previous.model;
      if (previous.thinking === undefined) delete process.env.CHALLENGE_THINKING;
      else process.env.CHALLENGE_THINKING = previous.thinking;
      if (previous.interpreterThinking === undefined) delete process.env.CHALLENGE_INTERPRETER_THINKING;
      else process.env.CHALLENGE_INTERPRETER_THINKING = previous.interpreterThinking;
    }
  });

  it("returns validation evidence without creating an artifact for a rejected candidate", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "product-spec-rejected-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "idea_spec.json");
    const result = await submitProductSpecCandidate("{}", SAMPLE_IDEA, segmentIdea(SAMPLE_IDEA), output);

    expect(result.accepted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes only a validated ProductSpec", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "product-spec-accepted-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "idea_spec.json");
    const spec = validProductSpec();
    const result = await submitProductSpecCandidate(
      JSON.stringify(spec),
      SAMPLE_IDEA,
      segmentIdea(SAMPLE_IDEA),
      output,
    );

    expect(result.accepted).toBe(true);
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(spec);
  });

  it("deterministically expands compact fragment references before validation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "product-spec-draft-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "idea_spec.json");
    const spec = validProductSpec();
    const { source_idea_hash: _hash, source_fragments: _fragments, ...semantic } = spec;
    const draft = {
      ...semantic,
      fragment_disposition: spec.fragment_disposition.map(({ requirement_ids: _requirementIds, ...disposition }) => disposition),
      requirements: spec.requirements.map((requirement) => ({
        ...requirement,
        source_refs: requirement.source_refs.map((reference) => reference.fragment_id),
      })),
      conflicts: spec.conflicts.map((conflict) => ({
        ...conflict,
        source_refs: conflict.source_refs.map((reference) => reference.fragment_id),
      })),
    };

    const result = await submitProductSpecDraftCandidate(
      JSON.stringify(draft),
      SAMPLE_IDEA,
      segmentIdea(SAMPLE_IDEA),
      output,
    );

    expect(result.accepted).toBe(true);
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(spec);
  });

  it("normalizes explicit negative scope and derives fragment mappings", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "product-spec-negative-scope-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "idea_spec.json");
    const spec = validProductSpec();
    const { source_idea_hash: _hash, source_fragments: _fragments, ...semantic } = spec;
    const reference = spec.requirements[0]!.source_refs[0]!.fragment_id;
    const draft = {
      ...semantic,
      fragment_disposition: spec.fragment_disposition.map(({ requirement_ids: _ids, ...disposition }) => disposition),
      requirements: [
        ...spec.requirements.map((requirement) => ({
          ...requirement,
          source_refs: requirement.source_refs.map((item) => item.fragment_id),
        })),
        {
          id: "req_no_login",
          title: "No login",
          description: "Authentication is outside this local MVP.",
          kind: "SCOPE",
          provenance: "EXPLICIT",
          disposition: "EXCLUDE",
          source_refs: [reference],
          journey_ids: [],
        },
      ],
      conflicts: spec.conflicts.map((conflict) => ({
        ...conflict,
        source_refs: conflict.source_refs.map((item) => item.fragment_id),
      })),
    };

    const result = await submitProductSpecDraftCandidate(JSON.stringify(draft), SAMPLE_IDEA, segmentIdea(SAMPLE_IDEA), output);
    expect(result.accepted).toBe(true);
    const saved = JSON.parse(await readFile(output, "utf8"));
    expect(saved.requirements.find((requirement: { id: string }) => requirement.id === "req_no_login").provenance)
      .toBe("EXCLUDED");
    expect(saved.fragment_disposition.find((disposition: { fragment_id: string }) => disposition.fragment_id === reference)
      .requirement_ids).toContain("req_no_login");
  });
});
