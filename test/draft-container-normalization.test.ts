import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { validateToolArguments } from '@earendil-works/pi-ai';
import interpreter, { productSpecDraftSchema } from '../solution/extensions/product-spec-interpreter.js';
import { normalizeDraftContainer } from '../src/product-spec/normalize-draft.js';
import { segmentIdea } from '../src/product-spec/fragments.js';
import { SAMPLE_IDEA, validProductSpec } from './fixtures/product-spec.js';

afterEach(() => vi.unstubAllEnvs());
function draftFixture() {
  const { source_idea_hash: _hash, source_fragments: _fragments, ...draft } = validProductSpec();
  return { ...draft, requirements: draft.requirements.map((requirement) => ({ ...requirement, source_refs: requirement.source_refs.map((ref) => ref.fragment_id) })) };
}

describe('exact root container normalization', () => {
  it('passes the actual SDK boundary and saves unchanged canonical meaning with an auditable original', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'draft-container-'));
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
      const tool = api.registerTool.mock.calls.map(([registered]) => registered).find((registered) => registered.name === 'submit_product_spec') as
        Parameters<typeof validateToolArguments>[0] & {
          prepareArguments(args: unknown): Record<string, unknown>;
          execute(id: string, args: unknown): Promise<{ details: { accepted: boolean } }>;
        };
      const canonicalDraft = draftFixture();
      const { product, fragment_disposition, ...misplaced } = canonicalDraft;
      const raw = { fragment_disposition, product: { ...product, ...misplaced } };
      const original = structuredClone(raw);
      const prepared = tool.prepareArguments({ draft: raw });
      const validated = validateToolArguments(tool, { type: 'toolCall', id: 'initial', name: tool.name, arguments: prepared });
      expect((await tool.execute('initial', validated)).details.accepted).toBe(true);
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(validProductSpec());
      expect(raw).toEqual(original);
      const audit = JSON.parse(await readFile(join(directory, 'draft-normalization.jsonl'), 'utf8'));
      expect(audit.raw_draft).toEqual(original);
      expect(audit.normalized_draft).toEqual(canonicalDraft);
      expect(audit.raw_sha256).toBe(createHash('sha256').update(JSON.stringify(original)).digest('hex'));
      expect(audit.normalized_sha256).toBe(createHash('sha256').update(JSON.stringify(audit.normalized_draft)).digest('hex'));
      expect(audit.moves).toEqual(Object.keys(misplaced).map((key) => ({ from: `/product/${key}`, to: `/${key}` })));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(['duplicate', 'conflicting', 'unknown', 'overlapping-container'])('rejects %s root/product meaning without partial normalization', (kind) => {
    const canonical = draftFixture();
    const { requirements, ...rest } = canonical;
    const raw: Record<string, unknown> = { ...rest, product: { ...canonical.product, requirements } };
    const product = raw.product as Record<string, unknown>;
    if (kind === 'duplicate') raw.requirements = requirements;
    if (kind === 'conflicting') raw.requirements = [];
    if (kind === 'unknown') product.unknown_scope = 'preserve this';
    if (kind === 'overlapping-container') product.product = { summary: 'another product' };
    const schema = productSpecDraftSchema();
    const result = normalizeDraftContainer(raw, schema);
    expect(result.draft).toBe(raw);
    expect(result.moves).toEqual([]);
    expect(() => validateToolArguments({ name: 'submit', description: '', parameters: Type.Unsafe(schema) },
      { type: 'toolCall', id: 'invalid', name: 'submit', arguments: result.draft as Record<string, unknown> })).toThrow();
  });
});
