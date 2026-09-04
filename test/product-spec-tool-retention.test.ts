import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import productSpecInterpreter from "../solution/extensions/product-spec-interpreter.js";
import { segmentIdea } from "../src/product-spec/fragments.js";
import { SAMPLE_IDEA, validProductSpec } from "./fixtures/product-spec.js";

afterEach(() => vi.unstubAllEnvs());

it("repairs a draft rejected by Pi's schema without resending it or bypassing validation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spec-tool-retention-"));
  try {
    const output = path.join(directory, "idea_spec.json");
    const idea = path.join(directory, "idea.txt");
    const fragments = path.join(directory, "fragments.json");
    await writeFile(idea, SAMPLE_IDEA);
    await writeFile(fragments, JSON.stringify(segmentIdea(SAMPLE_IDEA)));
    vi.stubEnv("SYSTEM_V0_IDEA_FILE", idea);
    vi.stubEnv("SYSTEM_V0_FRAGMENTS_FILE", fragments);
    vi.stubEnv("SYSTEM_V0_PRODUCT_SPEC_FILE", output);
    vi.stubEnv("SYSTEM_V0_PATTERN_AUDIT_FILE", path.join(directory, "patterns.jsonl"));
    const api = { registerTool: vi.fn() };
    productSpecInterpreter(api as unknown as ExtensionAPI);
    const tool = api.registerTool.mock.calls.map(([registered]) => registered).find((registered) => registered.name === "submit_product_spec") as
      Parameters<typeof validateToolArguments>[0] & {
        executionMode: string;
        prepareArguments(args: unknown): Record<string, unknown>;
        execute(id: string, args: unknown): Promise<{ details: { accepted: boolean }; terminate?: boolean }>;
      };
    expect(tool.executionMode).toBe("sequential");
    const spec = validProductSpec();
    spec.collection_execution = { mode: "custom", reason: "Exercise explicit custom generation with the canonical note scope." };
    const { source_idea_hash: _hash, source_fragments: _sourceFragments, ...semantic } = spec;
    const draft = {
      ...semantic,
      requirements: spec.requirements.map((requirement) => ({ ...requirement, source_refs: requirement.source_refs.map((reference) => reference.fragment_id) })),
    };
    draft.requirements[0]!.kind = "INVALID_KIND" as never;

    // This is the installed agent-core boundary: preparation precedes schema validation.
    const firstArguments = { draft };
    const prepared = tool.prepareArguments(firstArguments);
    expect(prepared).toBe(firstArguments);
    expect(() => validateToolArguments(tool, { type: "toolCall", id: "initial", name: tool.name, arguments: prepared }))
      .toThrow(/requirements\.0\.kind/);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });

    async function repair(value: unknown) {
      const arguments_ = tool.prepareArguments({ replacements: [{ path: "/requirements/0/kind", value }] });
      const validated = validateToolArguments(tool, { type: "toolCall", id: "repair", name: tool.name, arguments: arguments_ });
      return await tool.execute("repair", validated);
    }
    expect((await repair("STILL_INVALID")).details.accepted).toBe(false);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await repair("FUNCTIONAL")).toMatchObject({ details: { accepted: true }, terminate: true });
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(spec);
    expect(draft.requirements[0]!.kind).toBe("INVALID_KIND");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
