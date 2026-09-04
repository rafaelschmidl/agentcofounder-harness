import { describe, expect, it } from 'vitest';
import { compileCollection } from '../src/executable-collection/contract.js';
import { executableContract } from '../src/executable-collection/validate.js';
import { validateProductSpec } from '../src/product-spec/validate.js';
import { BOOK_IDEA, SAAS_IDEA, publicCollectionSpec } from './fixtures/executable-collection.js';

describe('canonical collection field bindings', () => {
  it('lowers exact field names across state predicates and action input without mutating canonical evidence', () => {
    const spec = publicCollectionSpec('book');
    for (const field of spec.entities[0]!.fields) field.id = `canonical_${field.id}`;
    const original = structuredClone(spec);
    expect(validateProductSpec(spec, BOOK_IDEA).errors).toEqual([]);
    const contract = executableContract(spec);
    expect(contract.canonicalFieldBindings).toEqual({ title: 'canonical_title', author: 'canonical_author', category: 'canonical_category', borrower: 'canonical_borrower' });
    const definition = compileCollection(contract);
    const record = { id: '1', canonical_title: 'A Wizard of Earthsea', canonical_author: 'Ursula Le Guin', canonical_category: 'Fantasy', canonical_borrower: '' };
    expect(definition.validStored(record)).toBe(true);
    expect(definition.actions[0]!.apply(record, { canonical_borrower: 'Maya' })).toMatchObject({ ok: true, patch: { canonical_borrower: 'Maya' } });
    expect(definition.actions[0]!.apply({ ...record, canonical_borrower: 'Maya' }, { canonical_borrower: 'Jo' }).ok).toBe(false);
    expect(spec).toEqual(original);
  });

  it('rejects competing exact names and duplicate declarations instead of selecting a field', () => {
    const spec = publicCollectionSpec('book');
    if (spec.collection_execution?.mode !== 'compiled') throw new Error('fixture');
    for (const field of spec.entities[0]!.fields) field.id = `canonical_${field.id}`;
    spec.collection_execution.contract.fields[0]!.label = 'Author';
    expect(validateProductSpec(spec, BOOK_IDEA).errors.join(' ')).toContain('ambiguous field binding for title');
    spec.collection_execution.contract.fields[0]!.label = 'Title';
    spec.collection_execution.contract.fields.push({ key: 'second_title', label: 'Title' });
    expect(validateProductSpec(spec, BOOK_IDEA).errors.join(' ')).toContain('duplicate field binding for canonical_title');
  });

  it('uses a unique exact closed set for hidden state but rejects competing sets and duplicate choices', () => {
    const spec = publicCollectionSpec('saas');
    if (spec.collection_execution?.mode !== 'compiled') throw new Error('fixture');
    const state = spec.entities[0]!.fields.find((field) => field.id === 'status')!;
    state.id = 'canonical_lifecycle'; state.name = 'Lifecycle';
    expect(validateProductSpec(spec, SAAS_IDEA).errors).toEqual([]);
    expect(executableContract(spec).canonicalFieldBindings).toEqual({ status: 'canonical_lifecycle' });
    spec.entities[0]!.fields.push({ ...structuredClone(state), id: 'other_lifecycle', name: 'Other lifecycle' });
    spec.collection_execution.contract.hidden!.other_lifecycle = { initial: 'inbox', choices: [...state.values] };
    expect(validateProductSpec(spec, SAAS_IDEA).errors.join(' ')).toContain('ambiguous field binding for status');
    spec.entities[0]!.fields.pop(); delete spec.collection_execution.contract.hidden!.other_lifecycle;
    state.values.push('inbox'); spec.collection_execution.contract.hidden!.status!.choices!.push('inbox');
    expect(validateProductSpec(spec, SAAS_IDEA).valid).toBe(false);
  });

  it('keeps contradictory required/enum metadata visible after binding', () => {
    const spec = publicCollectionSpec('saas');
    if (spec.collection_execution?.mode !== 'compiled') throw new Error('fixture');
    for (const field of spec.entities[0]!.fields) field.id = `canonical_${field.id}`;
    spec.collection_execution.contract.fields[3]!.required = false;
    spec.collection_execution.contract.fields[3]!.options = [{ value: 'urgent', label: 'Urgent' }];
    const errors = validateProductSpec(spec, SAAS_IDEA).errors.join(' ');
    expect(errors).toContain('required rule disagrees for canonical_priority');
    expect(errors).toContain('fields.canonical_priority.options');
  });

  it('does not silently move editable fields into protected workflow state', () => {
    const spec = publicCollectionSpec('book');
    if (spec.collection_execution?.mode !== 'compiled') throw new Error('fixture');
    for (const field of spec.entities[0]!.fields) field.id = `canonical_${field.id}`;
    delete spec.collection_execution.contract.hidden!.borrower;
    spec.collection_execution.contract.fields.push({ key: 'borrower', label: 'Borrower' });
    const original = structuredClone(spec);
    expect(validateProductSpec(spec, BOOK_IDEA).errors.join(' ')).toContain('state guards must use declared hidden fields');
    expect(spec).toEqual(original);
  });
});
