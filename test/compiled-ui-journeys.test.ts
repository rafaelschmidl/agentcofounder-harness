import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { compileProductSpec } from '../src/build-plan/compile.js';
import { materializeBuildPlan } from '../src/build-plan/materialize.js';
import { validateBuildPlan } from '../src/build-plan/validate.js';
import { finalizeUiJourneyFiles } from '../src/executable-collection/ui-journeys.js';
import { compileInteractionManifest, UI_MANIFEST_PATH } from '../src/executable-collection/interaction-manifest.js';
import { executableContract } from '../src/executable-collection/validate.js';
import { reconcileJourneyTests } from '../src/verify-app.js';
import { loadBuilderPrompts, loadRepairPrompts } from '../src/builder.js';
import { publicCollectionSpec } from './fixtures/executable-collection.js';
import { publicInteractionManifest } from './fixtures/interaction-manifest.js';

const run=promisify(execFile);
type Mutation='none'|'inert-action'|'lost-persistence'|'hidden-value'|'nested-hidden-value'|'missing-create'|'filter-noop'|'counter-constant';
type Layout='list'|'table'|'details';
// Plain reference fixtures for varied composition; never a default generated design.
function reference(kind:'book'|'saas',layout:Layout,mutation:Mutation){
  const fields=`Object.keys(definition.defaults).map(key=><span key={key} {...ui.field(key)} ${mutation==='hidden-value'?'style={{display:"none"}}':''}><span ${mutation==='nested-hidden-value'?'style={{display:"none"}}':''}>{collectionValue(definition,record,key)}</span></span>)`;
  const controls=`<button {...ui.edit(record)}>Change details</button><button {...ui.remove(record)}>Remove</button>{definition.actions.filter(action=>action.available(record)).map(action=><button key={action.id} {...ui.action(record,action.id)} ${mutation==='inert-action'?'onClick={()=>{}}':''}>{action.label}</button>)}`;
  const value=layout==='details'?`<span {...ui.field(definition.titleKey)}>{record[definition.titleKey]}</span><button {...ui.inspect(()=>setDetails(record.id))}>Inspect details</button>`:`<div>{${fields}}</div>`;
  const rows=layout==='table'?`<table><caption>Saved entries</caption><tbody>{visible.map(record=><tr key={record.id} {...ui.record(record)}><td>${value}</td><td>${controls}</td></tr>)}</tbody></table>`:`<section>{visible.map(record=><article key={record.id} {...ui.record(record)}>${value}<footer>${controls}</footer></article>)}</section>`;
  const filterControls=kind==='book'?`<select aria-label="Lending filter" {...ui.filter('lent')} value={filter} onChange={e=>setFilter(e.target.value)}><option value="*">All</option><option value="present">Lent</option><option value="empty">Available</option></select><span {...ui.count('lent')}>{${mutation==='counter-constant'?'0':"controller.records.filter(record=>record.borrower).length"}}</span>`
    :`<select aria-label="Status filter" {...ui.filter('status')} value={filter} onChange={e=>setFilter(e.target.value)}><option value="*">All</option>{['inbox','planned','in_progress','shipped'].map(value=><option key={value} value={value}>{value}</option>)}</select><select aria-label="Priority filter" {...ui.filter('priority')} value={priority} onChange={e=>setPriority(e.target.value)}><option value="*">All</option>{['low','medium','high'].map(value=><option key={value} value={value}>{value}</option>)}</select><span {...ui.count('active')}>{controller.records.filter(record=>record.status!=='shipped').length}</span><span {...ui.count('shipped')}>{controller.records.filter(record=>record.status==='shipped').length}</span>`;
  const filtering=mutation==='filter-noop'?'true':kind==='book'?`filter==='*'||(filter==='present'?Boolean(record.borrower):!record.borrower)`:`(filter==='*'||record.status===filter)&&(priority==='*'||record.priority===priority)`;
  return `import {useEffect,useState} from 'react';import {definition,useProductCollection,ProductEditor} from './domain';import {collectionUi,collectionValue} from '../system/collection-ui';
export default function App(){const controller=useProductCollection();const ui=collectionUi(controller);const [filter,setFilter]=useState('*');const[priority,setPriority]=useState('*');const[details,setDetails]=useState<string|null>(null);const selected=controller.records.find(record=>record.id===details);const visible=controller.records.filter(record=>${filtering});
useEffect(()=>{${mutation==='lost-persistence'?'localStorage.removeItem(definition.storageKey);':''}},[controller.records]);
return <main><header><h1>Reference collection</h1>${mutation==='missing-create'?'':'<button {...ui.create()}>New entry</button><button {...ui.create()}>Add another entry</button>'}</header>${filterControls}
{controller.notice?<p role={controller.notice.tone==='error'?'alert':'status'}>{controller.notice.text}</p>:null}<ProductEditor controller={controller}/>${rows}
{selected?<aside aria-label="Record details" {...ui.details(selected)}>{(()=>{const record=selected;return <>{${fields}}<button {...ui.closeDetails(()=>setDetails(null))}>Close details</button></>})()}</aside>:null}</main>;}`;
}

async function fixture(kind:'book'|'saas',test:(directory:string,source:(layout:Layout,mutation:Mutation)=>Promise<Record<string,any>>)=>Promise<void>,journeyCount=1){
  const directory=await mkdtemp(path.join(os.tmpdir(),'compiled-ui-product-'));const seed=path.resolve('app-template');
  try{
    await cp(seed,directory,{recursive:true,filter:source=>!source.split(path.sep).includes('node_modules')&&!source.endsWith(`${path.sep}dist`)});
    await symlink(path.join(seed,'node_modules'),path.join(directory,'node_modules'),'dir');
    const spec=publicCollectionSpec(kind);const manifest=publicInteractionManifest(kind);
    for(let index=1;index<journeyCount;index++){const id='journey_repeat_'+index;spec.acceptance_journeys.push({...spec.acceptance_journeys[0]!,id});spec.requirements[0]!.journey_ids.push(id);manifest.journeys.push({...structuredClone(manifest.journeys[0]!),id});}
    const plan=compileProductSpec(spec,{executableCollection:true,compiledUiJourneys:true});
    expect(validateBuildPlan(plan,spec)).toMatchObject({valid:true});
    expect(plan.file_ownership.find(file=>file.path==='src/product/product.test.tsx')?.owner).toBe('BLOCK');
    expect(plan.custom_slots[0]?.permitted_paths).toEqual(['src/product/App.tsx','src/product/styles.css',UI_MANIFEST_PATH]);
    await materializeBuildPlan(plan,spec,directory);await writeFile(path.join(directory,UI_MANIFEST_PATH),JSON.stringify(manifest));
    const builder=await loadBuilderPrompts(directory,plan);expect(builder.systemPrompt).toContain('interaction-manifest.json');expect(builder.appContext).toContain('export function collectionUi');
    const repair=await loadRepairPrompts(directory,plan,'Repair App only',['src/product/App.tsx']);expect(repair.systemPrompt).toContain('finish_repair');expect(repair.systemPrompt).not.toContain('Write exactly three complete');expect(repair.systemPrompt).not.toContain('Begin with write');
    expect(await finalizeUiJourneyFiles(plan,spec,directory)).toMatchObject({valid:true,unsupportedIds:[]});
    const before=await readFile(path.join(directory,'src/product/product.test.tsx'),'utf8');
    await test(directory,async(layout,mutation)=>{
      await writeFile(path.join(directory,'src/product/App.tsx'),reference(kind,layout,mutation));const result=path.join(directory,'result.json');
      try{await run(process.execPath,[path.join(seed,'node_modules/vitest/vitest.mjs'),'run','src/product/product.test.tsx','--reporter=json',`--outputFile=${result}`],{cwd:directory,timeout:45000});}
      catch(error){if(!(error as {stdout?:string}).stdout?.includes('JSON report written'))throw error;}
      expect(await readFile(path.join(directory,'src/product/product.test.tsx'),'utf8')).toBe(before);
      return JSON.parse(await readFile(result,'utf8')) as Record<string,any>;
    });
    const changed=publicInteractionManifest(kind);changed.unsupported=[{id:'journey_product',reason:'Attempt to discard failing assertions'}];changed.journeys=[];
    await writeFile(path.join(directory,UI_MANIFEST_PATH),JSON.stringify(changed));expect(await finalizeUiJourneyFiles(plan,spec,directory)).toMatchObject({valid:false});
    expect(await readFile(path.join(directory,'compiled-ui-manifest.json'),'utf8')).toBe(JSON.stringify(manifest)+'\n');
  }finally{await rm(directory,{recursive:true,force:true});}
}

it.each(['book','saas'] as const)('executes real typed %s journeys in free list/table/detail compositions',async kind=>{
  await fixture(kind,async(directory,source)=>{
    for(const layout of ['list','table','details'] as const){const report=await source(layout,'none');expect(report.numFailedTests,JSON.stringify(report.testResults)).toBe(0);expect(report.numPassedTests).toBe(1);expect(reconcileJourneyTests(report,[{id:'journey_product'}])[0]?.result).toBe('passed');}
    await run(process.execPath,[path.resolve('app-template/node_modules/typescript/bin/tsc'),'--noEmit'],{cwd:directory,timeout:15000});
  });
},120000);

it('fixed compiled tests reject broken actual UI operations, persistence, visibility, filters and counts',async()=>{
  await fixture('book',async(_directory,source)=>{
    for(const mutation of ['inert-action','lost-persistence','hidden-value','nested-hidden-value','missing-create','filter-noop','counter-constant'] as const){const report=await source('list',mutation);expect(report.numFailedTests,mutation).toBeGreaterThan(0);}
  });
},120000);

it('rejects vacuous/contradictory/unsupported programs and keeps uncovered journeys explicit',()=>{
  const spec=publicCollectionSpec('book');const contract=executableContract(spec);
  const valid=publicInteractionManifest('book');const compiled=compileInteractionManifest(valid,contract,spec);expect(compiled.journeys).toHaveLength(1);
  const rejected=compiled.journeys[0]!.steps.find(step=>step.op==='reject_save');expect(rejected?.before?.first?.borrower).toBe('Alex');expect(rejected?.before?.second?.title).toBe('Salt Fat Acid Heat');
  for(const change of [
    (x:any)=>{x.journeys[0].steps=[{op:'reload'}];},
    (x:any)=>{x.journeys[0].steps[0].values.title='';},
    (x:any)=>{x.journeys[0].steps[1].fields=['unknown_field'];},
    (x:any)=>{x.journeys[0].steps[0].op='run_javascript';},
    (x:any)=>{x.journeys[0].steps.splice(1,1);},
    (x:any)=>{x.counts[0].where={equals:{unknown:'yes'}};},
    (x:any)=>{x.display.title={values:{'The Left Hand':'Saved book','Salt Fat Acid Heat':'Saved book'}};},
  ]){const candidate=structuredClone(valid);change(candidate);expect(()=>compileInteractionManifest(candidate,contract,spec)).toThrow('Interaction manifest');}
  expect(compileInteractionManifest({version:1,filters:[],counts:[],journeys:[],unsupported:[{id:'journey_product',reason:'External operation not supported by this compiler'}]},contract,spec).journeys).toEqual([]);
  expect(compileProductSpec(spec,{executableCollection:true}).file_ownership.find(file=>file.path==='src/product/product.test.tsx')?.owner).toBe('AGENT');
});

it('isolates distinct manifest journeys through the materialized verification setup',async()=>{
  await fixture('book',async(_directory,source)=>{const report=await source('list','none');expect(report.numFailedTests,JSON.stringify(report.testResults)).toBe(0);expect(report.numPassedTests).toBe(2);},2);
},60000);

it('requires each filter to independently exclude records, and enum labels to preserve distinct values',()=>{
  const spec=publicCollectionSpec('saas'),contract=executableContract(spec),manifest=publicInteractionManifest('saas');
  const masked=structuredClone(manifest);masked.journeys[0]!.steps=masked.journeys[0]!.steps.filter(step=>!(step.op==='filter'&&step.filter==='status'&&step.value==='*'));
  expect(()=>compileInteractionManifest(masked,contract,spec)).toThrow('every declared filter');
  const collapsed=structuredClone(manifest);collapsed.display={status:{values:{inbox:'Open',planned:'Open'}}};expect(()=>compileInteractionManifest(collapsed,contract,spec)).toThrow('distinct');
});
