const text = { type: 'string' };
const nonempty = { type: 'string', minLength: 1 };
const key = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$', not: { enum: ['id','__proto__','constructor','prototype'] } };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required });
const array = (items: unknown) => ({ type: 'array', items });
const mapping = (value: unknown) => ({ type: 'object', propertyNames: key, additionalProperties: value });
const guard = object({ equals: mapping(text), empty: array(key), present: array(key) });
const field = object({ key, label: nonempty, type: { enum: ['text','textarea','select'] }, placeholder: text,
  required: { type: 'boolean' }, initial: text, options: array(object({ value: text, label: nonempty }, ['value','label'])) }, ['key','label']);
const contract = object({
  noun: nonempty, titleKey: key, fields: { ...array(field), minItems: 1, maxItems: 24 },
  hidden: mapping(object({ initial: text, required: { type: 'boolean' }, choices: array(text) }, ['initial'])),
  invariants: array(object({ when: guard, must: guard, message: nonempty }, ['when','must','message'])),
  state_binding: object({ workflow_id: nonempty, states: { type: 'object', additionalProperties: guard } }, ['workflow_id','states']),
  actions: array(object({ id: nonempty, label: nonempty, when: guard, input: array(field),
    transition_id: nonempty,
    assign: mapping({ anyOf: [text, object({ input: key }, ['input'])] }), message: nonempty }, ['id','label','when','assign','message'])),
}, ['noun','titleKey','fields','actions']);

export const COLLECTION_EXECUTION_SCHEMA = { anyOf: [
  object({ mode: { const: 'custom' }, reason: nonempty }, ['mode','reason']),
  object({ mode: { const: 'compiled' }, entity_id: nonempty, requirement_ids: { ...array(nonempty), minItems: 1, uniqueItems: true }, contract }, ['mode','entity_id','requirement_ids','contract']),
] };
