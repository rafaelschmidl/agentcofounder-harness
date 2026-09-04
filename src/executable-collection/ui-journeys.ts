import { readFileSync } from 'node:fs';
import type { CapabilityBlock } from '../build-plan/types.js';
import { compileCollection, type CollectionValues, type FieldRule, type FlatCollectionContract } from './contract.js';

export function exampleValues(fields: FieldRule[], suffix = ''): CollectionValues {
  return Object.fromEntries(fields.map((field) => [field.key, field.options?.at(-1)?.value ?? `Sample ${field.label}${suffix}`]));
}

export function collectionUiScenarios(contract: FlatCollectionContract) {
  const definition = compileCollection(contract);
  const initial = { ...definition.defaults, ...exampleValues(contract.fields), id: 'compiler-scenario' };
  if (Object.values(definition.validate(initial)).some(Boolean) || !definition.validStored(initial)) throw new Error('UI journey prototype cannot synthesize a valid initial record');
  type Step = { action: string; input: CollectionValues; expected: CollectionValues };
  const queue: Array<{ record: typeof initial; steps: Step[] }> = [{ record: initial, steps: [] }];
  const visited = new Set<string>();
  const covered = new Map<string, Step[]>();
  while (queue.length && visited.size < 128) {
    const current = queue.shift()!;
    const key = JSON.stringify(current.record);
    if (visited.has(key)) continue;
    visited.add(key);
    for (const action of definition.actions) {
      if (!action.available(current.record)) continue;
      const rule = contract.actions.find((item) => item.id === action.id)!;
      const input = exampleValues(rule.input ?? []);
      const result = action.apply(current.record, input);
      if (!result.ok) continue;
      const record = { ...current.record, ...result.patch };
      if (!definition.validStored(record)) continue;
      const steps = [...current.steps, { action: action.id, input, expected: record }];
      if (!covered.has(action.id)) covered.set(action.id, steps);
      queue.push({ record, steps });
    }
  }
  const missing = contract.actions.filter((action) => !covered.has(action.id)).map((action) => action.id);
  if (missing.length) throw new Error(`UI journey prototype lacks reachable sample inputs for actions: ${missing.join(', ')}`);
  return { initial, paths: [...covered].map(([action, steps]) => ({ action, steps })) };
}

export const COMPILED_UI_JOURNEYS_BLOCK: CapabilityBlock = {
  id: 'verification.collection-ui', version: '0.1.0',
  config_schema: { type: 'object', additionalProperties: false, required: ['contract'], properties: { contract: { type: 'object' } } },
  capabilities: ['protected-collection-ui-contract-tests'], dependencies: ['domain.executable-collection'], conflicts: [],
  owned_files: ['src/system/collection-ui.ts', 'src/product/product.test.tsx'],
  exported_interfaces: ['collectionUi', 'collectionValue'],
  checks: ['visible create/edit/delete/reload', 'canonical workflow edges via actual product controls', 'required form fields', 'failed storage write preserves visible and reloaded data'],
  materialize(config) {
    const contract = config.contract as FlatCollectionContract;
    const scenarios = collectionUiScenarios(contract);
    return [
      { path: 'src/system/collection-ui.ts', content: readFileSync(new URL('./ui-bindings.source.txt', import.meta.url), 'utf8') },
      { path: 'src/product/product.test.tsx', content: readFileSync(new URL('./ui-tests.source.txt', import.meta.url), 'utf8')
        .replace('__COMPILED_CONTRACT__', JSON.stringify(contract)).replace('__COMPILED_SCENARIOS__', JSON.stringify(scenarios)) },
    ];
  },
};
