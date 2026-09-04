import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { validateToolArguments } from '@earendil-works/pi-ai';
import interpreter from '../solution/extensions/product-spec-interpreter.js';
import { segmentIdea } from '../src/product-spec/fragments.js';
import { SAMPLE_IDEA, validProductSpec } from './fixtures/product-spec.js';

afterEach(() => vi.unstubAllEnvs());
type Result = { details: { accepted: boolean; previous_draft_retained?: boolean; errors?: string[]; rejected_replacements?: unknown }; content: { text: string }[] };
type Tool = Parameters<typeof validateToolArguments>[0] & {
  prepareArguments(args: unknown): Record<string, unknown>;
  execute(id: string, args: unknown): Promise<Result>;
};

async function fixture(run: (context: { submit: (args: Record<string, unknown>) => Promise<Result>; output: string }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'repair-retention-'));
  try {
    const output = join(directory, 'idea_spec.json');
    vi.stubEnv('SYSTEM_V0_IDEA_FILE', join(directory, 'idea.txt'));
    vi.stubEnv('SYSTEM_V0_FRAGMENTS_FILE', join(directory, 'fragments.json'));
    vi.stubEnv('SYSTEM_V0_PRODUCT_SPEC_FILE', output);
    vi.stubEnv('SYSTEM_V0_PATTERN_AUDIT_FILE', join(directory, 'patterns.jsonl'));
    await writeFile(join(directory, 'idea.txt'), SAMPLE_IDEA);
    await writeFile(join(directory, 'fragments.json'), JSON.stringify(segmentIdea(SAMPLE_IDEA)));
    const api = { registerTool: vi.fn() };
    interpreter(api as unknown as ExtensionAPI);
    const tool = api.registerTool.mock.calls.map(([item]) => item).find((item) => item.name === 'submit_product_spec') as Tool;
    await run({ output, submit: async (args) => {
      const prepared = tool.prepareArguments(args);
      const validated = validateToolArguments(tool, { type: 'toolCall', id: 'fixture', name: tool.name, arguments: prepared });
      return tool.execute('fixture', validated);
    } });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function draftFixture() {
  const { source_idea_hash: _hash, source_fragments: _fragments, ...draft } = validProductSpec();
  return { ...draft, requirements: draft.requirements.map((requirement) => ({ ...requirement, source_refs: requirement.source_refs.map((ref) => ref.fragment_id) })) };
}

describe('atomic retention of expandable drafts', () => {
  it('rejects an entire newly unexpandable batch, retains its attempted values, and accepts the next correct repair', async () => {
    await fixture(async ({ submit, output }) => {
      const draft = draftFixture();
      draft.acceptance_journeys[0]!.actor_id = 'missing_actor';
      expect((await submit({ draft })).details.accepted).toBe(false);
      const replacements = [
        { path: '/product/summary', value: 'This change must roll back too.' },
        { path: '/requirements/0', value: null },
      ];
      const rejected = await submit({ replacements });
      expect(rejected.details).toEqual({ accepted: false, previous_draft_retained: true, errors: ['requirements[0] must be an object'], rejected_replacements: replacements });
      expect(rejected.content[0]!.text).toContain('Previous draft retained. None of this replacement batch was applied.');
      await expect(access(output)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await submit({ replacements: [{ path: '/acceptance_journeys/0/actor_id', value: 'actor_owner' }] })).details.accepted).toBe(true);
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(validProductSpec());
    });
  });

  it('retains useful partial corrections while later semantic errors still need repair', async () => {
    await fixture(async ({ submit, output }) => {
      const draft = draftFixture();
      draft.acceptance_journeys[0]!.actor_id = 'first_missing_actor';
      draft.acceptance_journeys[1]!.actor_id = 'second_missing_actor';
      expect((await submit({ draft })).details.accepted).toBe(false);
      const partial = await submit({ replacements: [{ path: '/acceptance_journeys/0/actor_id', value: 'actor_owner' }] });
      expect(partial.details.accepted).toBe(false);
      expect(partial.details.previous_draft_retained).toBeUndefined();
      expect((await submit({ replacements: [{ path: '/acceptance_journeys/1/actor_id', value: 'actor_owner' }] })).details.accepted).toBe(true);
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(validProductSpec());
    });
  });

  it('keeps a schema-rejected initial raw draft available for structural then semantic repairs', async () => {
    await fixture(async ({ submit, output }) => {
      const draft = draftFixture();
      const requirement = structuredClone(draft.requirements[0]);
      draft.requirements[0] = null as never;
      draft.acceptance_journeys[0]!.actor_id = 'missing_actor';
      await expect(submit({ draft })).rejects.toThrow();
      const partial = await submit({ replacements: [{ path: '/requirements/0', value: requirement }] });
      expect(partial.details.accepted).toBe(false);
      expect(partial.details.previous_draft_retained).toBeUndefined();
      expect((await submit({ replacements: [{ path: '/acceptance_journeys/0/actor_id', value: 'actor_owner' }] })).details.accepted).toBe(true);
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(validProductSpec());
    });
  });
});
