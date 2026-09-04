import { compileCollection, matchesGuard, type FlatCollectionContract, type Guard } from './contract.js';
import type { ProductSpec } from '../product-spec/types.js';
import { bindCollectionFields } from './bindings.js';

/** Fill omitted structural metadata from canonical fields; explicit conflicts stay visible. */
function canonicalCollectionContract(spec: ProductSpec): Omit<FlatCollectionContract, 'storageKey' | 'canonicalIdentifier'> {
  const execution = spec.collection_execution;
  if (execution?.mode !== 'compiled') throw new Error('No compiled collection selected');
  const fields = spec.entities.find((item) => item.id === execution.entity_id)?.fields ?? [];
  const contract = bindCollectionFields(execution.contract, fields);
  for (const field of fields) {
    const editable = contract.fields.find((item) => item.key === field.id);
    const hidden = contract.hidden?.[field.id];
    const target = editable ?? hidden;
    if (target && !Object.hasOwn(target, 'required')) target.required = field.required;
    if (field.type === 'enum') {
      if (editable && !Object.hasOwn(editable, 'options')) editable.options = field.values.map((value) => ({ value, label: value }));
      if (hidden && !Object.hasOwn(hidden, 'choices')) hidden.choices = [...field.values];
    }
  }
  return contract;
}

/** Checks structural agreement with the canonical interpretation; prose remains independently tested. */
export function collectionExecutionErrors(spec: ProductSpec): string[] {
  const execution = spec.collection_execution;
  if (!execution || execution.mode === 'custom') return [];
  const errors: string[] = [];
  const reject = (message: string, unsupported = false) => errors.push(`collection_execution: ${message}${unsupported ? '; choose mode custom to preserve these unsupported semantics' : ''}`);
  let contract: ReturnType<typeof canonicalCollectionContract>;
  try { contract = canonicalCollectionContract(spec); }
  catch (error) { return [`collection_execution: ${error instanceof Error ? error.message : String(error)}`]; }
  if (spec.persistence.mode !== 'LOCAL' || spec.entities.length !== 1 || spec.entities[0]?.id !== execution.entity_id
    || spec.entities.some((entity) => entity.relationships.length > 0)
    || spec.integrations.some((integration) => integration.mode !== 'NONE')
    || spec.selected_patterns.some((pattern) => /transaction|commerce|checkout/u.test(pattern))) reject('requires one flat local collection without relationships, integrations or transactions', true);
  const fields = contract.fields;
  const hidden = contract.hidden ?? {};
  const keys = [...fields.map((field) => field.key), ...Object.keys(hidden)];
  const entity = spec.entities.find((item) => item.id === execution.entity_id);
  if ((entity?.fields.filter((field) => field.type === 'identifier').length ?? 0) > 1) reject('only one generated identifier is supported', true);
  for (const field of entity?.fields ?? []) {
    if (field.type === 'identifier') continue;
    if (!['string','enum'].includes(field.type)) { reject(`field ${field.id} has unsupported type ${field.type}`, true); continue; }
    if (!keys.includes(field.id)) { reject(`add canonical field ${field.id} to contract.fields or contract.hidden`); continue; }
    const editable = fields.find((item) => item.key === field.id);
    const concealed = hidden[field.id];
    if (Boolean(editable?.required ?? concealed?.required) !== field.required) reject(`required rule disagrees for ${field.id}`);
    const choices = editable?.options?.map((option) => option.value) ?? concealed?.choices ?? [];
    if (field.type === 'enum' && JSON.stringify([...choices].sort()) !== JSON.stringify([...field.values].sort())) reject(`repair ${editable ? `fields.${field.id}.options` : `hidden.${field.id}.choices`} to contain exactly ${JSON.stringify(field.values)}; enum choices can coexist with state bindings and invariants`);
    if (field.type === 'string' && choices.length) reject(`remove enum options/choices from canonical free-text field ${field.id}`);
  }
  if (keys.some((candidate) => entity?.fields.some((field) => field.id === candidate && field.type === 'identifier'))) reject('generated identifier fields must not be editable or hidden; the compiler maps the canonical identifier to record.id');
  if (keys.some((candidate) => !entity?.fields.some((field) => field.id === candidate))) reject('remove undeclared entity fields from the contract, or correct the canonical entity first');
  const implemented = new Set(spec.requirements.filter((requirement) => requirement.disposition === 'IMPLEMENT').map((requirement) => requirement.id));
  if (execution.requirement_ids.some((id) => !implemented.has(id))) reject('mapped requirement is not implemented');
  const binding = contract.state_binding;
  if (spec.workflows.length > 1) reject('at most one workflow is supported', true);
  if (spec.workflows.length === 1 && !binding) reject('add a state_binding for the canonical workflow');
  if (binding) {
    const workflow = spec.workflows.find((item) => item.id === binding.workflow_id);
    if (!workflow || workflow.entity_id !== execution.entity_id) reject('state_binding references the wrong workflow');
    else {
      if (JSON.stringify(Object.keys(binding.states).sort()) !== JSON.stringify([...workflow.states].sort())) reject('state_binding must name every canonical workflow state exactly');
      const transitions = contract.actions.map((action) => action.transition_id).filter(Boolean);
      if (JSON.stringify([...transitions].sort()) !== JSON.stringify(workflow.transitions.map((transition) => transition.id).sort())) reject('actions must cover each canonical workflow transition exactly once');
      if (contract.actions.some((action) => !action.transition_id)) reject('every workflow action must bind to a canonical transition');
      const defaults = Object.fromEntries(Object.entries(hidden).map(([key, rule]) => [key, rule.initial]));
      const initial = binding.states[workflow.initial_state];
      if (!initial || !matchesGuard(initial, defaults) || Object.values(binding.states).filter((guard) => matchesGuard(guard, defaults)).length !== 1) reject('hidden defaults must select only the canonical initial workflow state');
    }
    for (const guard of Object.values(binding.states)) {
      const references = [...Object.keys(guard.equals ?? {}), ...(guard.empty ?? []), ...(guard.present ?? [])];
      if (!references.length || references.some((field) => !Object.hasOwn(hidden, field))) reject('state guards must use declared hidden fields');
    }
    // Auxiliary transition data (for example an assignee) can be just as stateful
    // as the field used by state_binding. Generic create/edit bypasses transitions.
    const actionOwnedFields = new Set(contract.actions.flatMap((action) => Object.keys(action.assign)));
    const editableActionFields = fields.filter((field) => actionOwnedFields.has(field.key)).map((field) => field.key);
    if (editableActionFields.length) reject(`workflow-assigned fields ${editableActionFields.join(', ')} must be hidden, not general create/edit fields; use action inputs for transition data. Do not drop any source requirement to edit these fields`, true);
  } else if (contract.actions.some((action) => action.transition_id)) reject('transition_id requires a canonical workflow binding');
  try { compileCollection({ ...contract, storageKey: 'validation-only' }); }
  catch (error) { reject(error instanceof Error ? error.message : String(error)); }
  return errors;
}

/** The executable source/target guards come from canonical from/to states, never action guesses. */
export function executableContract(spec: ProductSpec): FlatCollectionContract {
  if (spec.collection_execution?.mode !== 'compiled') throw new Error('No compiled collection selected');
  const errors = collectionExecutionErrors(spec);
  if (errors.length) throw new Error(errors.join('\n'));
  const contract = canonicalCollectionContract(spec);
  const binding = contract.state_binding;
  const workflow = spec.workflows.find((item) => item.id === binding?.workflow_id);
  const identifier = spec.entities[0]?.fields.find((field) => field.type === 'identifier');
  return {
    ...contract,
    storageKey: `agent-cofounder:${spec.source_idea_hash.slice(7, 23)}`,
    ...(identifier ? { canonicalIdentifier: identifier.id } : {}),
    actions: contract.actions.map((action) => {
      const transition = workflow?.transitions.find((item) => item.id === action.transition_id);
      return transition && binding ? { ...action, source: binding.states[transition.from] as Guard, target: binding.states[transition.to] as Guard } : action;
    }),
  };
}
