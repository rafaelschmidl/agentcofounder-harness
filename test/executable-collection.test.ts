import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileProductSpec } from '../src/build-plan/compile.js';
import { validateBuildPlan } from '../src/build-plan/validate.js';
import { linkBuildPlan, materializeBuildPlan } from '../src/build-plan/materialize.js';
import { validateProductSpec } from '../src/product-spec/validate.js';
import { productSpecDraftSchema } from '../solution/extensions/product-spec-interpreter.js';
import { mayAgentWrite } from '../solution/extensions/owned-paths.js';
import { loadBuilderPrompts } from '../src/builder.js';
import { scopeRepairToOwnership } from '../src/run-challenge.js';
import { compileCollection } from '../src/executable-collection/contract.js';
import { executableContract } from '../src/executable-collection/validate.js';
import { publicCollectionSpec, BOOK_IDEA, SAAS_IDEA } from './fixtures/executable-collection.js';

afterEach(() => vi.unstubAllEnvs());
const run = promisify(execFile);

describe('opt-in executable collections', () => {
  it.each(['book','saas'] as const)('validates the full public %s spec, while default/custom paths keep four agent files', (kind) => {
    const spec = publicCollectionSpec(kind);
    expect(validateProductSpec(spec, kind === 'book' ? BOOK_IDEA : SAAS_IDEA).errors).toEqual([]);
    expect(compileProductSpec(spec).file_ownership.filter((file) => file.owner === 'AGENT')).toHaveLength(4);
    spec.collection_execution = { mode: 'custom', reason: 'A custom product can retain existing generation.' };
    expect(compileProductSpec(spec, { executableCollection: true }).file_ownership.filter((file) => file.owner === 'AGENT')).toHaveLength(4);
  });

  it('makes contract choice explicit only in the opt-in tool schema and keeps closed validation', () => {
    vi.stubEnv('CHALLENGE_EXECUTABLE_COLLECTION', '0');
    expect((productSpecDraftSchema().properties as Record<string, unknown>).collection_execution).toBeUndefined();
    vi.stubEnv('CHALLENGE_EXECUTABLE_COLLECTION', '1');
    expect(productSpecDraftSchema().required).toContain('collection_execution');
    const spec = publicCollectionSpec('book');
    const injected = { ...spec, collection_execution: { ...spec.collection_execution, arbitrary_script: 'do something' } };
    expect(validateProductSpec(injected, BOOK_IDEA).valid).toBe(false);
    spec.entities[0]!.fields[0]!.type = 'number';
    expect(validateProductSpec(spec, BOOK_IDEA).errors.join(' ')).toContain('unsupported');
  });

  it('injects canonical guards and prevents broad/wrong action guards from permitting skips', () => {
    const spec = publicCollectionSpec('saas');
    const definition = compileCollection(executableContract(spec));
    expect(definition.actions.find((action) => action.id === 'ship')!.available({ id: '1', customer: 'A', title: 'Export', category: 'Data', priority: 'high', status: 'inbox' })).toBe(false);
    if (spec.collection_execution?.mode !== 'compiled') throw new Error('fixture');
    spec.collection_execution.contract.actions[0]!.assign.status = 'shipped';
    const incorrect = compileCollection(executableContract(spec));
    expect(incorrect.actions[0]!.apply({ id: '1', customer: 'A', title: 'Export', category: 'Data', priority: 'high', status: 'inbox' }, {})).toMatchObject({ ok: false, message: expect.stringContaining('required workflow state') });
    spec.collection_execution.contract.state_binding!.states = { inbox: {} };
    expect(validateProductSpec(spec, SAAS_IDEA).valid).toBe(false);
  });

  it('validates complete-record invariants, enum fields, hidden state and state exclusivity', () => {
    const contract = executableContract(publicCollectionSpec('book'));
    contract.invariants = [{ when: { equals: { category: 'Reference only' } }, must: { empty: ['borrower'] }, message: 'Reference books remain on the shelf.' }];
    const definition = compileCollection(contract);
    const record = { id: '1', title: 'Index', author: 'A', category: 'Reference only', borrower: 'Jo' };
    expect(definition.validStored(record)).toBe(false);
    expect(definition.validStored({ ...record, borrower: '' })).toBe(true);
    const saas = compileCollection(executableContract(publicCollectionSpec('saas')));
    expect(saas.validStored({ id: '1', customer: 'A', title: 'Export', category: 'Data', priority: 'critical', status: 'inbox' })).toBe(false);
  });

  it('rejects a wrong initial state, unbound workflow action, or unsupported identifier rather than silently changing semantics', () => {
    const spec = publicCollectionSpec('saas');
    if (spec.collection_execution?.mode !== 'compiled') throw new Error('fixture');
    spec.collection_execution.contract.hidden!.status!.initial = 'shipped';
    expect(validateProductSpec(spec, SAAS_IDEA).errors.join(' ')).toContain('canonical initial');
    spec.collection_execution.contract.hidden!.status!.initial = 'inbox';
    spec.collection_execution.contract.actions.push({ id: 'shortcut', label: 'Shortcut', when: {}, assign: { status: 'shipped' }, message: 'Done.' });
    expect(validateProductSpec(spec, SAAS_IDEA).errors.join(' ')).toContain('bind to a canonical transition');
    spec.collection_execution.contract.actions.pop();
    spec.entities[0]!.fields.push({ id: 'invoice_number', name: 'Invoice number', type: 'identifier', required: true, values: [], validation: [] });
    expect(validateProductSpec(spec, SAAS_IDEA).errors.join(' ')).toContain('controller-owned id');
  });

  it('rejects invalid field choices and guards direct action calls as well as controller calls', () => {
    const contract = executableContract(publicCollectionSpec('saas'));
    const definition = compileCollection(contract);
    expect(definition.actions.find((action) => action.id === 'ship')!.apply({ id: '1', customer: 'A', title: 'Export', category: 'Data', priority: 'high', status: 'inbox' }, {})).toMatchObject({ ok: false });
    contract.fields[3]!.options!.push({ value: 'high', label: 'High again' });
    expect(() => compileCollection(contract)).toThrow('duplicate choices');
  });

  it('preserves optional hidden enum absence and rejects padded stored enums that filters cannot classify', () => {
    const spec = publicCollectionSpec('book');
    if (spec.collection_execution?.mode !== 'compiled') throw new Error('fixture');
    spec.entities[0]!.fields.push({ id: 'label', name: 'Label', type: 'enum', required: false, values: ['work', 'home'], validation: [] });
    spec.collection_execution.contract.hidden!.label = { initial: '', choices: ['work', 'home'] };
    expect(validateProductSpec(spec, BOOK_IDEA).errors).toEqual([]);
    const definition = compileCollection(executableContract(spec));
    const record = { id: '1', title: 'Example', author: 'Ursula', category: 'Novel', borrower: '', label: '' };
    expect(definition.validStored(record)).toBe(true);
    expect(definition.validStored({ ...record, label: 'home' })).toBe(true);
    expect(definition.validStored({ ...record, label: ' home ' })).toBe(false);
    const required = structuredClone(spec);
    required.entities[0]!.fields.at(-1)!.required = true;
    if (required.collection_execution?.mode !== 'compiled') throw new Error('fixture');
    required.collection_execution.contract.hidden!.label!.required = true;
    expect(validateProductSpec(required, BOOK_IDEA).errors.join(' ')).toContain('Required hidden default is empty');
    const saas = compileCollection(executableContract(publicCollectionSpec('saas')));
    expect(saas.validStored({ id: '2', title: 'Export', customer: 'Jo', category: 'Data', priority: ' high ', status: 'inbox' })).toBe(false);
  });

  it('materializes protected domain API, three owned files, honest repair scope, and rejects config tampering', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'executable-materialize-'));
    try {
      const spec = publicCollectionSpec('book'), plan = compileProductSpec(spec, { executableCollection: true });
      expect(validateBuildPlan(plan, spec).errors).toEqual([]);
      await cp(path.resolve('app-template/AGENTS.md'), path.join(directory, 'AGENTS.md'));
      await materializeBuildPlan(plan, spec, directory);
      const owned = plan.file_ownership.filter((entry) => entry.owner === 'AGENT').map((entry) => entry.path);
      expect(owned).toEqual(['src/product/App.tsx','src/product/product.test.tsx','src/product/styles.css']);
      expect(mayAgentWrite(directory, plan.file_ownership, 'src/product/domain.ts')).toBe(false);
      const prompts = await loadBuilderPrompts(directory, plan);
      expect(prompts.systemPrompt).toContain('three AGENT-owned files');
      expect(prompts.appContext).toContain('export function useProductCollection');
      expect(prompts.appContext).toContain('"borrower"');
      expect(prompts.appContext).not.toContain('export function compileCollection');
      const scoped = scopeRepairToOwnership({ key: 'x', sourceFingerprint: 'test', stage: 'tests', permittedPaths: ['src/product/domain.ts','src/product/product.test.tsx'], evidence: '## Permitted repair paths\n\n- src/product/domain.ts\n\n## Failure\n\nwrong result' }, plan);
      expect(scoped.permittedPaths).toEqual(['src/product/product.test.tsx']);
      expect(scoped.evidence).toContain('never weaken journey assertions');
      (plan.blocks.find((block) => block.id === 'domain.executable-collection')!.config.contract as { noun: string }).noun = 'tampered';
      expect(validateBuildPlan(plan, spec).valid).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('executes real materialized Book/SaaS controller, editor and storage behaviors offline', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'executable-behavior-'));
    try {
      const seed = path.resolve('app-template');
      await cp(seed, directory, { recursive: true, filter: (file) => !file.split(path.sep).includes('node_modules') && !file.endsWith(`${path.sep}dist`) });
      await symlink(path.join(seed, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
      const spec = publicCollectionSpec('book'), plan = compileProductSpec(spec, { executableCollection: true });
      await materializeBuildPlan(plan, spec, directory); await linkBuildPlan(plan, spec, directory);
      await cp(path.resolve('test/fixtures/executable-collection.behavior.test.tsx'), path.join(directory, 'src/test/executable-collection.behavior.test.tsx'));
      await writeFile(path.join(directory, 'src/test/contracts.ts'), `export const saas = ${JSON.stringify(executableContract(publicCollectionSpec('saas')))};\n`);
      await run(process.execPath, [path.join(seed, 'node_modules/vitest/vitest.mjs'), 'run', 'src/test/executable-collection.behavior.test.tsx'], { cwd: directory, timeout: 20_000 })
        .catch((error: { stdout?: string; stderr?: string }) => { throw new Error(`${error.stdout}\n${error.stderr}`); });
      await run(process.execPath, [path.join(seed, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: directory, timeout: 12_000 })
        .catch((error: { stdout?: string; stderr?: string }) => { throw new Error(`${error.stdout}\n${error.stderr}`); });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 35_000);
});
