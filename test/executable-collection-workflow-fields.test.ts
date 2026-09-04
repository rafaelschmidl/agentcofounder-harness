import { describe, expect, it } from 'vitest';
import { compileCollection, type CollectionItem } from '../src/executable-collection/contract.js';
import { executableContract } from '../src/executable-collection/validate.js';
import { validateProductSpec } from '../src/product-spec/validate.js';
import { BOOK_IDEA, publicCollectionSpec } from './fixtures/executable-collection.js';

// Reproduces the accepted b626 contract's shape: the protected state enum and
// editable borrower can disagree because CRUD does not run workflow actions.
function splitStateSpec() {
  const spec = publicCollectionSpec('book');
  if (spec.collection_execution?.mode !== 'compiled') throw new Error('fixture');
  const contract = spec.collection_execution.contract;
  spec.entities[0]!.fields.push({ id: 'loan_state', name: 'Loan state', type: 'enum', required: true, values: ['available', 'lent'], validation: ['Lent if and only if borrower is present.'] });
  contract.hidden!.loan_state = { initial: 'available', required: true, choices: ['available', 'lent'] };
  contract.state_binding!.states = { available: { equals: { loan_state: 'available' } }, lent: { equals: { loan_state: 'lent' } } };
  contract.actions[0]!.assign.loan_state = 'lent';
  contract.actions[1]!.assign.loan_state = 'available';
  delete contract.hidden!.borrower;
  contract.fields.push({ key: 'borrower', label: 'Borrower', required: false });
  return { spec, contract };
}

describe('workflow-owned collection fields', () => {
  it('rejects editable transition data even when the state binding itself is hidden, without rewriting the draft', () => {
    const { spec } = splitStateSpec();
    const original = structuredClone(spec);
    const errors = validateProductSpec(spec, BOOK_IDEA).errors.join(' ');
    expect(errors).toContain('workflow-assigned fields borrower must be hidden');
    expect(errors).toContain('Do not drop any source requirement to edit these fields');
    expect(errors).toContain('choose mode custom');
    expect(() => executableContract(spec)).toThrow('workflow-assigned fields borrower');
    expect(spec).toEqual(original);
  });

  it('does not treat an unrelated invariant as proof that ordinary editing preserves the workflow', () => {
    const { spec, contract } = splitStateSpec();
    contract.invariants = [{ when: { present: ['title'] }, must: { present: ['author'] }, message: 'An authored book needs an author.' }];
    expect(validateProductSpec(spec, BOOK_IDEA).errors.join(' ')).toContain('workflow-assigned fields borrower must be hidden');
  });

  it('allows hidden transition values with action inputs, while ordinary bibliographic edits preserve the loan', () => {
    const { spec, contract } = splitStateSpec();
    contract.fields = contract.fields.filter((field) => field.key !== 'borrower');
    contract.hidden!.borrower = { initial: '' };
    contract.invariants = [
      { when: { equals: { loan_state: 'available' } }, must: { empty: ['borrower'] }, message: 'Available books have no borrower.' },
      { when: { equals: { loan_state: 'lent' } }, must: { present: ['borrower'] }, message: 'Lent books need a borrower.' },
    ];
    expect(validateProductSpec(spec, BOOK_IDEA).errors).toEqual([]);
    const definition = compileCollection(executableContract(spec));
    expect(definition.fields.map((field) => field.key)).toEqual(['title', 'author', 'category']);
    const initial = { ...definition.defaults, id: 'record-1', title: 'A Book', author: 'A Writer', category: 'Any category' };
    expect(definition.validStored(initial)).toBe(true);
    const lend = definition.actions[0]!;
    expect(lend.fields?.map((field) => field.key)).toEqual(['borrower']);
    expect(lend.apply(initial, { borrower: '' })).toMatchObject({ ok: false });
    const lent = lend.apply(initial, { borrower: 'Alex' });
    if (!lent.ok) throw new Error('expected successful lending');
    const edited: CollectionItem = { ...initial, ...lent.patch, author: 'Corrected Writer' };
    expect(definition.validStored(edited)).toBe(true);
    expect(edited.borrower).toBe('Alex');
    const returned = definition.actions[1]!.apply(edited, {});
    if (!returned.ok) throw new Error('expected successful return');
    expect(definition.validStored({ ...edited, ...returned.patch })).toBe(true);
    expect(returned.patch).toMatchObject({ borrower: '', loan_state: 'available' });
  });

  it('resolves aliases before assessing persisted assignments and keeps action input names in their own namespace', () => {
    const { spec, contract } = splitStateSpec();
    spec.entities[0]!.fields.find((field) => field.id === 'borrower')!.id = 'canonical_borrower';
    spec.entities[0]!.fields.find((field) => field.id === 'canonical_borrower')!.name = 'Borrower';
    expect(validateProductSpec(spec, BOOK_IDEA).errors.join(' ')).toContain('workflow-assigned fields canonical_borrower must be hidden');
    const valid = publicCollectionSpec('book');
    if (valid.collection_execution?.mode !== 'compiled') throw new Error('fixture');
    const action = valid.collection_execution.contract.actions[0]!;
    action.input = [{ key: 'title', label: 'Borrower name', required: true }];
    action.assign.borrower = { input: 'title' };
    expect(validateProductSpec(valid, BOOK_IDEA).errors).toEqual([]);
    const definition = compileCollection(executableContract(valid));
    expect(definition.actions[0]!.apply({ ...definition.defaults, id: '1', title: 'Original book', author: 'Writer', category: 'Novel' }, { title: 'Alex' }))
      .toMatchObject({ ok: true, patch: { borrower: 'Alex' } });
    expect(contract.fields.find((field) => field.key === 'borrower')).toBeDefined();
  });

  it('preserves canonical requirements when a product needing general workflow-data edits selects custom fallback', () => {
    const { spec } = splitStateSpec();
    const canonical = { requirements: structuredClone(spec.requirements), entities: structuredClone(spec.entities), workflows: structuredClone(spec.workflows) };
    spec.collection_execution = { mode: 'custom', reason: 'General borrower editing must update lending state atomically; preserve the required edit behavior.' };
    expect(validateProductSpec(spec, BOOK_IDEA).errors).toEqual([]);
    expect({ requirements: spec.requirements, entities: spec.entities, workflows: spec.workflows }).toEqual(canonical);
  });

  it('does not extend workflow-only ownership to actions without a canonical workflow', () => {
    const spec = publicCollectionSpec('book');
    if (spec.collection_execution?.mode !== 'compiled') throw new Error('fixture');
    spec.workflows = [];
    delete spec.collection_execution.contract.state_binding;
    spec.collection_execution.contract.actions = [{ id: 'retitle', label: 'Retitle', when: {}, input: [{ key: 'name', label: 'New title', required: true }], assign: { title: { input: 'name' } }, message: 'Title changed.' }];
    expect(validateProductSpec(spec, BOOK_IDEA).errors).toEqual([]);
  });
});
