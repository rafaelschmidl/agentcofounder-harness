import { compileCollection, matchesGuard, type FlatCollectionContract, type Guard } from './contract.js';
import type { ProductSpec } from '../product-spec/types.js';

/** Checks structural agreement with the canonical interpretation; prose remains independently tested. */
export function collectionExecutionErrors(spec: ProductSpec): string[] {
  const execution = spec.collection_execution;
  if (!execution || execution.mode === 'custom') return [];
  const errors: string[] = [];
  const reject = (message: string) => errors.push(`collection_execution: ${message}; use mode custom for unsupported semantics`);
  if (spec.persistence.mode !== 'LOCAL' || spec.entities.length !== 1 || spec.entities[0]?.id !== execution.entity_id
    || spec.entities.some((entity) => entity.relationships.length > 0)
    || spec.integrations.some((integration) => integration.mode !== 'NONE')
    || spec.selected_patterns.some((pattern) => /transaction|commerce|checkout/u.test(pattern))) reject('requires one flat local collection without relationships, integrations or transactions');
  const fields = execution.contract.fields;
  const hidden = execution.contract.hidden ?? {};
  const keys = [...fields.map((field) => field.key), ...Object.keys(hidden)];
  const entity = spec.entities.find((item) => item.id === execution.entity_id);
  for (const field of entity?.fields ?? []) {
    if (field.type === 'identifier') {
      if (field.id !== 'id') reject(`identifier field ${field.id} is not the controller-owned id`);
      continue;
    }
    if (!['string','enum'].includes(field.type) || !keys.includes(field.id)) { reject(`field ${field.id} is unsupported or missing`); continue; }
    const editable = fields.find((item) => item.key === field.id);
    const concealed = hidden[field.id];
    if (Boolean(editable?.required ?? concealed?.required) !== field.required) reject(`required rule disagrees for ${field.id}`);
    const choices = editable?.options?.map((option) => option.value) ?? concealed?.choices ?? [];
    if (field.type === 'enum' && JSON.stringify([...choices].sort()) !== JSON.stringify([...field.values].sort())) reject(`enum choices disagree for ${field.id}`);
    if (field.type === 'string' && choices.length) reject(`free-text field ${field.id} cannot acquire an enum`);
  }
  if (keys.some((candidate) => !entity?.fields.some((field) => field.id === candidate && field.type !== 'identifier'))) reject('contract includes undeclared entity fields');
  const implemented = new Set(spec.requirements.filter((requirement) => requirement.disposition === 'IMPLEMENT').map((requirement) => requirement.id));
  if (execution.requirement_ids.some((id) => !implemented.has(id))) reject('mapped requirement is not implemented');
  const binding = execution.contract.state_binding;
  if (spec.workflows.length > 1 || (spec.workflows.length === 1 && !binding)) reject('each supported workflow requires a state_binding; at most one workflow is supported');
  if (binding) {
    const workflow = spec.workflows.find((item) => item.id === binding.workflow_id);
    if (!workflow || workflow.entity_id !== execution.entity_id) reject('state_binding references the wrong workflow');
    else {
      if (JSON.stringify(Object.keys(binding.states).sort()) !== JSON.stringify([...workflow.states].sort())) reject('state_binding must name every canonical workflow state exactly');
      const transitions = execution.contract.actions.map((action) => action.transition_id).filter(Boolean);
      if (JSON.stringify([...transitions].sort()) !== JSON.stringify(workflow.transitions.map((transition) => transition.id).sort())) reject('actions must cover each canonical workflow transition exactly once');
      if (execution.contract.actions.some((action) => !action.transition_id)) reject('every workflow action must bind to a canonical transition');
      const defaults = Object.fromEntries(Object.entries(hidden).map(([key, rule]) => [key, rule.initial]));
      const initial = binding.states[workflow.initial_state];
      if (!initial || !matchesGuard(initial, defaults) || Object.values(binding.states).filter((guard) => matchesGuard(guard, defaults)).length !== 1) reject('hidden defaults must select only the canonical initial workflow state');
    }
    for (const guard of Object.values(binding.states)) {
      const references = [...Object.keys(guard.equals ?? {}), ...(guard.empty ?? []), ...(guard.present ?? [])];
      if (!references.length || references.some((field) => !Object.hasOwn(hidden, field))) reject('state guards must use declared hidden fields');
    }
  } else if (execution.contract.actions.some((action) => action.transition_id)) reject('transition_id requires a canonical workflow binding');
  try { compileCollection({ ...execution.contract, storageKey: 'validation-only' }); }
  catch (error) { reject(error instanceof Error ? error.message : String(error)); }
  return errors;
}

/** The executable source/target guards come from canonical from/to states, never action guesses. */
export function executableContract(spec: ProductSpec): FlatCollectionContract {
  if (spec.collection_execution?.mode !== 'compiled') throw new Error('No compiled collection selected');
  const errors = collectionExecutionErrors(spec);
  if (errors.length) throw new Error(errors.join('\n'));
  const contract = structuredClone(spec.collection_execution.contract);
  const binding = contract.state_binding;
  const workflow = spec.workflows.find((item) => item.id === binding?.workflow_id);
  return {
    ...contract,
    storageKey: `agent-cofounder:${spec.source_idea_hash.slice(7, 23)}`,
    actions: contract.actions.map((action) => {
      const transition = workflow?.transitions.find((item) => item.id === action.transition_id);
      return transition && binding ? { ...action, source: binding.states[transition.from] as Guard, target: binding.states[transition.to] as Guard } : action;
    }),
  };
}
