// Pure, self-contained runtime: the compiler also ships this exact file to apps.
export interface RecordField { key: string; label: string; type?: 'text' | 'textarea' | 'select'; placeholder?: string; options?: { value: string; label: string }[] }
export type CollectionValues = Record<string, string>;
export type CollectionErrors = Partial<Record<string, string>>;
export type CollectionItem = CollectionValues & { id: string };
export type ActionResult = { ok: true; patch: CollectionValues; message: string } | { ok: false; errors: CollectionErrors; message?: string };
export interface CollectionDefinition {
  storageKey: string; noun: string; titleKey: string; fields: RecordField[]; defaults: CollectionValues;
  validate: (values: CollectionValues) => CollectionErrors;
  validStored: (record: CollectionItem) => boolean;
  actions: { id: string; label: string; fields?: RecordField[] | undefined; initialValues?: CollectionValues; available: (record: CollectionItem) => boolean; apply: (record: CollectionItem, input: CollectionValues) => ActionResult }[];
}

export type FieldRule = RecordField & { required?: boolean; initial?: string };
export interface Guard { equals?: Record<string, string>; empty?: string[]; present?: string[] }
export interface FlatCollectionContract {
  storageKey: string; noun: string; titleKey: string;
  fields: FieldRule[];
  hidden?: Record<string, { initial: string; choices?: string[]; required?: boolean }>;
  invariants?: Array<{ when: Guard; must: Guard; message: string }>;
  state_binding?: { workflow_id: string; states: Record<string, Guard> };
  actions: Array<{
    id: string; label: string; when: Guard; input?: FieldRule[];
    transition_id?: string;
    // Only the deterministic compiler supplies source/target from canonical transitions.
    source?: Guard; target?: Guard;
    assign: Record<string, string | { input: string }>; message: string;
  }>;
}

function fieldErrors(fields: FieldRule[], values: CollectionValues): CollectionErrors {
  return Object.fromEntries(fields.flatMap((field) => {
    const value = values[field.key] ?? '';
    if (field.required && !value.trim()) return [[field.key, `${field.label} is required.`]];
    if (value && field.options && !field.options.some((option) => option.value === value)) return [[field.key, `Choose a valid ${field.label.toLowerCase()}.`]];
    return [];
  }));
}
export function matchesGuard(guard: Guard, record: CollectionValues): boolean {
  return Object.entries(guard.equals ?? {}).every(([key, value]) => record[key] === value)
    && (guard.empty ?? []).every((key) => !record[key]?.trim())
    && (guard.present ?? []).every((key) => Boolean(record[key]?.trim()));
}

/** Pure adapter, with no UI, storage, effects or replacement controller. */
export function compileCollection(contract: FlatCollectionContract): CollectionDefinition {
  const hidden = contract.hidden ?? {};
  const keys = [...contract.fields.map((field) => field.key), ...Object.keys(hidden)];
  const ids = contract.actions.map((action) => action.id);
  if (new Set(keys).size !== keys.length || keys.some((key) => ['id', '__proto__', 'constructor', 'prototype'].includes(key)) || !keys.includes(contract.titleKey)
    || new Set(ids).size !== ids.length) throw new Error('Duplicate/reserved field, action, or invalid title key.');
  for (const [key, rule] of Object.entries(hidden)) {
    if (rule.choices && (rule.choices.length === 0 || new Set(rule.choices).size !== rule.choices.length)) throw new Error(`Empty or duplicate choices: ${key}`);
    if (rule.choices && rule.initial !== '' && !rule.choices.includes(rule.initial)) throw new Error(`Invalid hidden default: ${key}`);
    if (rule.required && !rule.initial.trim()) throw new Error(`Required hidden default is empty: ${key}`);
  }
  const guardKeys = (guard: Guard) => [...Object.keys(guard.equals ?? {}), ...(guard.empty ?? []), ...(guard.present ?? [])];
  for (const field of [...contract.fields, ...contract.actions.flatMap((action) => action.input ?? [])]) {
    const choices = field.options?.map((option) => option.value);
    if (choices && (choices.length === 0 || new Set(choices).size !== choices.length)) throw new Error(`Empty or duplicate choices: ${field.key}`);
    if (field.type === 'select' && !choices) throw new Error(`Select field requires choices: ${field.key}`);
    if (choices && field.initial && !choices.includes(field.initial)) throw new Error(`Invalid editable default: ${field.key}`);
  }
  for (const invariant of contract.invariants ?? []) if ([...guardKeys(invariant.when), ...guardKeys(invariant.must)].some((key) => !keys.includes(key))) throw new Error('Unknown invariant field.');
  for (const guard of Object.values(contract.state_binding?.states ?? {})) if (guardKeys(guard).some((key) => !keys.includes(key))) throw new Error('Unknown state binding field.');
  for (const action of contract.actions) {
    const input = action.input ?? [];
    const inputs = input.map((field) => field.key);
    if (new Set(inputs).size !== inputs.length) throw new Error('Duplicate action input.');
    const references = [...guardKeys(action.when), ...guardKeys(action.source ?? {}), ...guardKeys(action.target ?? {}), ...Object.keys(action.assign)];
    if (references.some((key) => !keys.includes(key))) throw new Error('Unknown guarded or assigned field.');
    if (Object.values(action.assign).some((value) => typeof value !== 'string' && !inputs.includes(value.input))) throw new Error('Unknown action input reference.');
  }
  return {
    storageKey: contract.storageKey, noun: contract.noun, titleKey: contract.titleKey,
    fields: contract.fields.map((field) => field.options ? { ...field, type: 'select' as const } : field),
    defaults: Object.fromEntries([...contract.fields.map((field) => [field.key, field.initial ?? '']), ...Object.entries(hidden).map(([key, rule]) => [key, rule.initial])]),
    validate: (values) => fieldErrors(contract.fields, values),
    validStored: (record) => Object.keys(record).every((key) => key === 'id' || keys.includes(key))
      && keys.every((key) => typeof record[key] === 'string')
      && !Object.keys(fieldErrors(contract.fields, record)).length
      && Object.entries(hidden).every(([key, rule]) => (!rule.required || Boolean(record[key]?.trim())) && (!rule.choices || record[key] === '' || rule.choices.includes(record[key] ?? '')))
      && (contract.invariants ?? []).every((rule) => !matchesGuard(rule.when, record) || matchesGuard(rule.must, record))
      && (!contract.state_binding || Object.values(contract.state_binding.states).filter((guard) => matchesGuard(guard, record)).length === 1),
    actions: contract.actions.map((action) => ({
      id: action.id, label: action.label, fields: action.input?.map((field) => field.options ? { ...field, type: 'select' as const } : field),
      initialValues: Object.fromEntries((action.input ?? []).map((field) => [field.key, field.initial ?? ''])),
      available: (record) => matchesGuard(action.when, record) && (!action.source || matchesGuard(action.source, record)),
      apply: (record, input) => {
        if (!matchesGuard(action.when, record) || (action.source && !matchesGuard(action.source, record))) return { ok: false, errors: {}, message: 'That action is no longer available.' };
        const errors = fieldErrors(action.input ?? [], input);
        if (Object.keys(errors).length) return { ok: false, errors };
        const patch = Object.fromEntries(Object.entries(action.assign)
          .map(([key, value]) => [key, typeof value === 'string' ? value : (input[value.input] ?? '').trim()]));
        if (action.target && !matchesGuard(action.target, { ...record, ...patch })) return { ok: false, errors: {}, message: 'That change does not reach the required workflow state.' };
        const invariant = contract.invariants?.find((rule) => matchesGuard(rule.when, { ...record, ...patch }) && !matchesGuard(rule.must, { ...record, ...patch }));
        if (invariant) return { ok: false, errors: {}, message: invariant.message };
        return { ok: true, message: action.message, patch };
      },
    })),
  };
}
