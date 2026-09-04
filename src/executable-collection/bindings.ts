import type { EntityField } from '../product-spec/types.js';
import type { FlatCollectionContract, Guard } from './contract.js';
import type { CollectionExecution } from './types.js';

type Draft = Extract<CollectionExecution, { mode: 'compiled' }>['contract'];
type BoundDraft = Omit<FlatCollectionContract, 'storageKey' | 'canonicalIdentifier'>;
const comparableName = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[\s_-]+/gu, ' ').trim();
const sameChoices = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

/** Canonical IDs are authoritative. Alias lowering requires one exact structural match. */
export function bindCollectionFields(draft: Draft, canonical: EntityField[]): BoundDraft {
  const contract = structuredClone(draft);
  const fields = canonical.filter((field) => field.type !== 'identifier');
  const bindings = new Map<string, string>();
  const claimed = new Map<string, string>();
  function bind(key: string, label?: string, hiddenChoices?: string[]) {
    if (canonical.some((field) => field.id === key && field.type === 'identifier')) {
      throw new Error(`generated identifier ${key} cannot be an editable or hidden field`);
    }
    const exact = fields.find((field) => field.id === key);
    const names = new Set([key, ...(label ? [label] : [])].map(comparableName));
    let candidates = exact ? [exact] : fields.filter((field) => names.has(comparableName(field.name)));
    if (!exact && candidates.length === 0 && hiddenChoices) {
      candidates = fields.filter((field) => field.type === 'enum' && sameChoices(field.values, hiddenChoices));
    }
    if (candidates.length > 1) throw new Error(`ambiguous field binding for ${key}; use an exact canonical field ID`);
    const candidate = candidates[0];
    if (!candidate) return; // Normal validation reports an undeclared or missing field.
    if (claimed.has(candidate.id)) throw new Error(`duplicate field binding for ${candidate.id}: ${claimed.get(candidate.id)} and ${key}`);
    claimed.set(candidate.id, key);
    if (candidate.id !== key) bindings.set(key, candidate.id);
  }
  for (const field of contract.fields) bind(field.key, field.label);
  for (const [key, rule] of Object.entries(contract.hidden ?? {})) bind(key, undefined, rule.choices);
  const key = (value: string) => bindings.get(value) ?? value;
  function mapEntries<T>(value: Record<string, T>): Record<string, T> {
    const entries = Object.entries(value).map(([name, item]) => [key(name), item] as const);
    if (new Set(entries.map(([name]) => name)).size !== entries.length) throw new Error('duplicate field references after canonical binding');
    return Object.fromEntries(entries);
  }
  const guard = (value: Guard): Guard => ({
    ...(value.equals ? { equals: mapEntries(value.equals) } : {}),
    ...(value.empty ? { empty: value.empty.map(key) } : {}),
    ...(value.present ? { present: value.present.map(key) } : {}),
  });
  return {
    ...contract,
    titleKey: key(contract.titleKey),
    fields: contract.fields.map((field) => ({ ...field, key: key(field.key) })),
    ...(contract.hidden ? { hidden: mapEntries(contract.hidden) } : {}),
    ...(contract.invariants ? { invariants: contract.invariants.map((rule) => ({ ...rule, when: guard(rule.when), must: guard(rule.must) })) } : {}),
    ...(contract.state_binding ? { state_binding: { ...contract.state_binding, states: Object.fromEntries(Object.entries(contract.state_binding.states).map(([state, predicate]) => [state, guard(predicate)])) } } : {}),
    actions: contract.actions.map((action) => ({
      ...action, when: guard(action.when),
      ...(action.input ? { input: action.input.map((field) => ({ ...field, key: key(field.key) })) } : {}),
      assign: mapEntries(Object.fromEntries(Object.entries(action.assign).map(([name, value]) => [name, typeof value === 'string' ? value : { input: key(value.input) }]))),
    })),
    ...(bindings.size ? { canonicalFieldBindings: Object.fromEntries(bindings) } : {}),
  };
}
