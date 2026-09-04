import { compileCollection, matchesGuard, type CollectionValues, type FlatCollectionContract, type Guard } from './contract.js';
import type { ProductSpec } from '../product-spec/types.js';

export const UI_MANIFEST_PATH = 'src/product/interaction-manifest.json';
export type UiMutation = { op: 'create'; record: string; values: CollectionValues } | { op: 'edit'; record: string; values: CollectionValues }
  | { op: 'action'; record: string; action: string; input?: CollectionValues } | { op: 'remove'; record: string };
export type UiStep = UiMutation | { op: 'expect'; record: string; fields: string[] } | { op: 'reload' }
  | { op: 'filter'; filter: string; value: string } | { op: 'visible' } | { op: 'count'; counter: string }
  | { op: 'reject_save'; mutation: UiMutation } | { op: 'invalid_create'; values: CollectionValues; field: string };
export interface InteractionManifest {
  version: 1;
  display?: Record<string, { empty?: string; format?: string; values?: Record<string, string> }>;
  filters: { id: string; field: string; kind: 'equals' | 'present' }[];
  counts: { id: string; where: Guard; exclude?: Guard }[];
  journeys: { id: string; steps: UiStep[] }[];
  unsupported: { id: string; reason: string }[];
}
export type CompiledUiStep = UiStep & { expected?: CollectionValues; before?: Record<string, CollectionValues>; visible?: string[]; absent?: string[]; expectedCount?: number };
export interface CompiledUiManifest { manifest: InteractionManifest; journeys: { id: string; steps: CompiledUiStep[] }[] }
function fail(message: string): never { throw new Error(`Interaction manifest: ${message}`); }
const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value: Record<string, any>, keys: string[], label: string) {
  const unknown = Object.keys(value).filter(key => !keys.includes(key)); if (unknown.length) fail(`${label} has unsupported keys: ${unknown.join(', ')}`);
}
function identifier(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/u.test(value) && !['constructor','prototype','__proto__'].includes(value); }
function stringMap(value: unknown, keys: string[], label: string): asserts value is CollectionValues {
  if (!object(value) || Object.entries(value).some(([key,v]) => !keys.includes(key) || typeof v !== 'string' || v.length > 300)) fail(`${label} requires known fields and short string values`);
}

/** Compile explicit executable checks; ID correspondence alone never creates a test. */
export function compileInteractionManifest(input: unknown, contract: FlatCollectionContract, spec: ProductSpec): CompiledUiManifest {
  if (!object(input)) fail('expected a JSON object');
  exactKeys(input, ['version','display','filters','counts','journeys','unsupported'], 'root');
  if (input.version !== 1 || !['filters','counts','journeys','unsupported'].every(key => Array.isArray(input[key])) || input.journeys.length > 20) fail('version 1 and bounded array fields are required');
  const fields = [...contract.fields.map(field=>field.key), ...Object.keys(contract.hidden ?? {})];
  const editable = contract.fields.map(field=>field.key);
  const definition = compileCollection(contract);
  if (input.display !== undefined) {
    if (!object(input.display)) fail('display must be an object');
    for (const [key,rule] of Object.entries(input.display)) {
      if (!fields.includes(key) || !object(rule)) fail(`unknown displayed field ${key}`);
      exactKeys(rule,['empty','format','values'],`display ${key}`);
      if (rule.empty !== undefined && (typeof rule.empty !== 'string' || !rule.empty.trim())) fail('empty display text must remain visible');
      if (rule.format !== undefined && (typeof rule.format !== 'string' || !rule.format.includes('{value}'))) fail('display format must contain {value}');
      if (rule.values !== undefined && (!object(rule.values) || Object.values(rule.values).some(value=>typeof value!=='string'||!value.trim()))) fail('display values require visible labels');
      if (rule.values !== undefined) {
        const field=contract.fields.find(field=>field.key===key);
        const choices=field?.options?.map(option=>({value:option.value,label:option.label}))??contract.hidden?.[key]?.choices?.map(value=>({value,label:value.replace(/_/g,' ')}));
        if(!choices||Object.keys(rule.values).some(value=>!choices.some(choice=>choice.value===value)))fail('display values may rename only canonical enum choices, never free text');
        const labels=choices.map(choice=>(rule.values[choice.value]??choice.label).trim());
        if(new Set(labels).size!==labels.length)fail('enum display labels must remain distinct');
      }
    }
  }
  for (const filter of input.filters) {
    if (!object(filter)) fail('invalid filter'); exactKeys(filter,['id','field','kind'],'filter');
    if (!identifier(filter.id) || !fields.includes(filter.field) || !['equals','present'].includes(filter.kind)) fail('filter requires an ID, canonical field and equals/present kind');
  }
  for (const counter of input.counts) {
    if (!object(counter)) fail('invalid counter'); exactKeys(counter,['id','where','exclude'],'counter');
    if (!identifier(counter.id) || !object(counter.where)) fail('counter requires ID and a field guard');
    for(const guard of [counter.where,...(counter.exclude!==undefined?[counter.exclude]:[])]) {
      if(!object(guard))fail('counter guard must be an object');exactKeys(guard,['equals','empty','present'],'counter guard');
      if (guard.equals !== undefined) stringMap(guard.equals,fields,'counter guard');
      for (const key of ['empty','present']) if (guard[key] !== undefined && (!Array.isArray(guard[key]) || guard[key].some((field:unknown)=>!fields.includes(String(field))))) fail('counter guard references unknown fields');
    }
  }
  const ids = [...input.journeys,...input.unsupported].map(entry=>entry?.id);
  const canonical = spec.acceptance_journeys.map(journey=>journey.id);
  if (new Set(ids).size !== ids.length || JSON.stringify([...ids].sort()) !== JSON.stringify([...canonical].sort())) fail('account for each canonical journey exactly once in journeys or unsupported');
  for (const unsupported of input.unsupported) {
    if (!object(unsupported)) fail('invalid unsupported entry'); exactKeys(unsupported,['id','reason'],'unsupported');
    if (typeof unsupported.reason !== 'string' || unsupported.reason.trim().length < 12) fail('unsupported journeys need a concrete explanation');
  }
  for (const values of [input.filters,input.counts]) if (new Set(values.map((value:any)=>value.id)).size !== values.length) fail('duplicate filter or counter ID');
  const manifest = input as InteractionManifest;
  const coveredActions = new Set<string>(), shownFields = new Set<string>(), usedFilters = new Set<string>(), counterValues = new Map<string,Set<number>>();
  let reloadObserved = false;
  const journeys = manifest.journeys.map(journey => {
    if (!object(journey)) fail('invalid journey'); exactKeys(journey,['id','steps'],'journey');
    if (!Array.isArray(journey.steps) || !journey.steps.length || journey.steps.length > 60) fail(`journey ${journey.id} needs 1–60 executable steps`);
    let records: Record<string,CollectionValues> = {};
    const created = new Set<string>(); const selected: Record<string,string> = {};
    let meaningful = 0, mutated = 0, reloaded = false;
    let pending: {record:string;fields:string[];removed:boolean}|undefined;
    function mutation(step: UiMutation): CollectionValues | undefined {
      if (!identifier(step.record)) fail('record aliases must be short identifiers');
      if (step.op === 'create') {
        exactKeys(step,['op','record','values'],'create');
        if (created.has(step.record)) fail('record aliases cannot be reused');
        stringMap(step.values,editable,'create values');
        const values = {...definition.defaults,...step.values,id:step.record};
        if (Object.values(definition.validate(values)).some(Boolean)||!definition.validStored(values)) fail('create step must supply a valid complete record');
        records[step.record]=values; created.add(step.record); return {...values};
      }
      const record=records[step.record]; if(!record) fail(`unknown record ${step.record}`);
      if(step.op==='remove') { exactKeys(step,['op','record'],'remove'); delete records[step.record]; return undefined; }
      if(step.op==='edit') {
        exactKeys(step,['op','record','values'],'edit');stringMap(step.values,editable,'edit values');
        if(!Object.entries(step.values).some(([key,value])=>record[key]!==value)) fail('edit must change a value');
        const next={...record,...step.values};if(Object.values(definition.validate(next)).some(Boolean)||!definition.validStored(next as typeof next & {id:string})) fail('edit creates an invalid record'); records[step.record]=next; return {...next};
      }
      exactKeys(step,['op','record','action','input'],'action');
      const action=definition.actions.find(action=>action.id===step.action); if(!action) fail('unknown canonical action');
      stringMap(step.input??{},(action.fields??[]).map(field=>field.key),'action input');
      const result=action.apply(record as typeof record & {id:string},step.input??{});
      if(!action.available(record as typeof record & {id:string})||!result.ok) fail('action step must reach a valid canonical transition');
      const next={...record,...result.patch};if(!definition.validStored(next as typeof next & {id:string})) fail('action violates canonical invariants');
      records[step.record]=next;coveredActions.add(step.action);return {...next};
    }
    const steps=journey.steps.map((step):CompiledUiStep=>{
      if(!object(step)||typeof step.op!=='string') fail('invalid step');
      if(['create','edit','action','remove'].includes(step.op)) {
        if(pending)fail(`assert the changed record ${pending.record} before the next mutation`);
        const changed=step as UiMutation;const expected=mutation(changed);mutated++;reloaded=false;
        pending={record:changed.record,removed:changed.op==='remove',fields:changed.op==='create'?editable:changed.op==='edit'?Object.keys(changed.values):changed.op==='action'?Object.keys(contract.actions.find(action=>action.id===changed.action)!.assign):[]};
        return {...step,...(expected?{expected}: {})};
      }
      if(step.op==='expect') {
        exactKeys(step,['op','record','fields'],'expect');
        if(!records[step.record]||!Array.isArray(step.fields)||!step.fields.length||step.fields.some(field=>!fields.includes(field))) fail('expect requires a live record and real canonical fields');
        step.fields.forEach(field=>shownFields.add(field));meaningful++;if(reloaded)reloadObserved=true;
        if(pending?.record===step.record&&!pending.removed){pending.fields=pending.fields.filter(field=>!step.fields.includes(field));if(!pending.fields.length)pending=undefined;}
        return {...step,expected:{...records[step.record]}};
      }
      if(step.op==='reload') { exactKeys(step,['op'],'reload');if(!mutated)fail('reload must follow an actual mutation');Object.keys(selected).forEach(key=>delete selected[key]);reloaded=true;return step; }
      if(step.op==='filter') {
        exactKeys(step,['op','filter','value'],'filter step');const filter=manifest.filters.find(filter=>filter.id===step.filter);if(!filter||typeof step.value!=='string')fail('unknown filter or invalid value');
        if(filter.kind==='present'&&!['*','present','empty'].includes(step.value))fail('present filter values are *, present or empty');
        selected[step.filter]=step.value;return step;
      }
      if(step.op==='visible') {
        exactKeys(step,['op'],'visible');const visible:string[]=[],absent:string[]=[];
        for(const name of created){const record=records[name];const matches=Boolean(record)&&manifest.filters.every(filter=>{
          const value=selected[filter.id];return !value||value==='*'||(filter.kind==='equals'?record![filter.field]===value:value==='present'?Boolean(record![filter.field]?.trim()):!record![filter.field]?.trim());
        });(matches?visible:absent).push(name);}
        if(!created.size)fail('visibility assertions need created records');
        // A filter earns coverage only when removing that filter would admit a live
        // excluded record. Another active filter cannot mask a no-op implementation.
        if(visible.length)for(const filter of manifest.filters){
          if(!selected[filter.id]||selected[filter.id]==='*')continue;
          const excludesIndependently=absent.some(alias=>records[alias]&&manifest.filters.filter(other=>other.id!==filter.id).every(other=>{
            const value=selected[other.id],record=records[alias]!;return !value||value==='*'||(other.kind==='equals'?record[other.field]===value:value==='present'?Boolean(record[other.field]?.trim()):!record[other.field]?.trim());
          }));
          if(excludesIndependently)usedFilters.add(filter.id);
        }
        if(pending?.removed&&absent.includes(pending.record))pending=undefined;
        meaningful++;if(reloaded)reloadObserved=true;return {...step,visible,absent};
      }
      if(step.op==='count') {
        exactKeys(step,['op','counter'],'count');const counter=manifest.counts.find(counter=>counter.id===step.counter);if(!counter||!created.size)fail('count requires an actual collection and declared counter');
        const value=Object.values(records).filter(record=>matchesGuard(counter.where,record)&&(!counter.exclude||!matchesGuard(counter.exclude,record))).length;
        const seen=counterValues.get(counter.id)??new Set<number>();seen.add(value);counterValues.set(counter.id,seen);meaningful++;return {...step,expectedCount:value};
      }
      if(step.op==='invalid_create') {
        exactKeys(step,['op','values','field'],'invalid create');stringMap(step.values,editable,'invalid create values');
        if(!Object.hasOwn(definition.validate({...definition.defaults,...step.values}),step.field))fail('invalid_create must actually violate the named canonical field');
        meaningful++;mutated++;return {...step,before:structuredClone(records)};
      }
      if(step.op==='reject_save') {
        exactKeys(step,['op','mutation'],'reject save');if(!object(step.mutation)||!['create','edit','action','remove'].includes(step.mutation.op))fail('reject_save requires a valid mutation');
        if(pending)fail('assert previous changes before reject_save');
        const before=structuredClone(records);const aliases=new Set(created);const actionsBefore=new Set(coveredActions);const expected=mutation(step.mutation);records=before;created.clear();aliases.forEach(alias=>created.add(alias));coveredActions.clear();actionsBefore.forEach(action=>coveredActions.add(action));meaningful++;mutated++;
        return {...step,before:structuredClone(before),...(expected?{expected}: {})};
      }
      return fail(`unsupported operator ${(step as {op:string}).op}`);
    });
    if(pending)fail(`journey ${journey.id} ends without asserting changed record ${pending.record}`);
    if(!mutated||!meaningful)fail(`journey ${journey.id} must interact and assert resulting behavior`);
    return {id:journey.id,steps};
  });
  if(manifest.journeys.length && !manifest.unsupported.length) {
    const missingActions=contract.actions.filter(action=>!coveredActions.has(action.id)).map(action=>action.id);
    if(missingActions.length)fail(`complete supported coverage must exercise canonical actions: ${missingActions.join(', ')}`);
    const missingFields=fields.filter(field=>!shownFields.has(field));if(missingFields.length)fail(`complete supported coverage must inspect fields: ${missingFields.join(', ')}`);
    if(spec.persistence.mode==='LOCAL'&&!reloadObserved)fail('persistent journeys need reload followed by visible assertions');
    if(manifest.filters.some(filter=>!usedFilters.has(filter.id)))fail('every declared filter needs included and excluded records with a visibility assertion');
    if(manifest.counts.some(counter=>(counterValues.get(counter.id)?.size??0)<2))fail('every declared counter needs assertions at two distinct derived values');
  }
  return {manifest,journeys};
}
