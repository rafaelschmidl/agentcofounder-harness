import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { compileProductSpec } from '../src/build-plan/compile.js';
import { materializeBuildPlan } from '../src/build-plan/materialize.js';
import { validateBuildPlan } from '../src/build-plan/validate.js';
import { collectionUiScenarios } from '../src/executable-collection/ui-journeys.js';
import { executableContract } from '../src/executable-collection/validate.js';
import { reconcileJourneyTests } from '../src/verify-app.js';
import { publicCollectionSpec } from './fixtures/executable-collection.js';

const run = promisify(execFile);
type Mutation = 'none' | 'inert-action' | 'lost-persistence' | 'hidden-value' | 'missing-create';
// Deliberately plain reference fixtures, never a default product design.
function reference(layout: 'list' | 'table', mutation: Mutation) {
  const fields = `Object.keys(definition.defaults).map(key => <span key={key} {...ui.field(key)} ${mutation === 'hidden-value' ? 'style={{display:"none"}}' : ''}>{collectionValue(definition,record,key)}</span>)`;
  const controls = `<button {...ui.edit(record)}>Change details</button><button {...ui.remove(record)}>Remove</button>
    {definition.actions.filter(action=>action.available(record)).map(action=><button key={action.id} {...ui.action(record,action.id)} ${mutation === 'inert-action' ? 'onClick={()=>{}}' : ''}>{action.label}</button>)}`;
  const rows = layout === 'list'
    ? `<section>{controller.records.map(record=><article key={record.id} {...ui.record(record)}><div>{${fields}}</div><footer>${controls}</footer></article>)}</section>`
    : `<table><caption>Saved entries</caption><tbody>{controller.records.map(record=><tr key={record.id} {...ui.record(record)}><td>{${fields}}</td><td>${controls}</td></tr>)}</tbody></table>`;
  return `import {useEffect} from 'react';
import {definition,useProductCollection,ProductEditor} from './domain';
import {collectionUi,collectionValue} from '../system/collection-ui';
export default function App(){const controller=useProductCollection(); const ui=collectionUi(controller);
  useEffect(()=>{${mutation === 'lost-persistence' ? 'localStorage.removeItem(definition.storageKey);' : ''}},[controller.records]);
  return <main><header><h1>Reference collection</h1>${mutation === 'missing-create' ? '' : '<button {...ui.create()}>New entry</button>'}</header>
  {controller.notice?<p role={controller.notice.tone==='error'?'alert':'status'}>{controller.notice.text}</p>:null}
  <ProductEditor controller={controller}/>${rows}</main>;
}`;
}

async function generatedFixture(kind: 'book' | 'saas', test: (directory: string, source: (layout: 'list' | 'table', mutation: Mutation) => Promise<Record<string, any>>) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'compiled-ui-product-'));
  const seed = path.resolve('app-template');
  try {
    await cp(seed, directory, { recursive: true, filter: (source) => !source.split(path.sep).includes('node_modules') && !source.endsWith(`${path.sep}dist`) });
    await symlink(path.join(seed, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    const spec = publicCollectionSpec(kind);
    const plan = compileProductSpec(spec, { executableCollection: true, compiledUiJourneys: true });
    expect(validateBuildPlan(plan,spec)).toMatchObject({valid:true});
    expect(plan.file_ownership.find(file=>file.path==='src/product/product.test.tsx')?.owner).toBe('BLOCK');
    expect(plan.custom_slots[0]?.permitted_paths).toEqual(['src/product/App.tsx','src/product/styles.css']);
    await materializeBuildPlan(plan,spec,directory);
    const testsBefore = await readFile(path.join(directory,'src/product/product.test.tsx'),'utf8');
    await test(directory,async(layout,mutation)=>{
      await writeFile(path.join(directory,'src/product/App.tsx'),reference(layout,mutation));
      const result = path.join(directory,'result.json');
      try { await run(process.execPath,[path.join(seed,'node_modules/vitest/vitest.mjs'),'run','src/product/product.test.tsx','--reporter=json',`--outputFile=${result}`],{cwd:directory,timeout:15000}); }
      catch(error) { if (!(error as {stdout?:string}).stdout?.includes('JSON report written')) throw error; }
      expect(await readFile(path.join(directory,'src/product/product.test.tsx'),'utf8')).toBe(testsBefore);
      return JSON.parse(await readFile(result,'utf8')) as Record<string, any>;
    });
  } finally { await rm(directory,{recursive:true,force:true}); }
}

it.each(['book','saas'] as const)('protects compiler tests while exercising actual %s App through visible controls',async(kind)=>{
  await generatedFixture(kind,async(directory,source)=>{
    for(const layout of ['list','table'] as const){
      const report=await source(layout,'none');
      expect(report.numFailedTests,JSON.stringify(report.testResults)).toBe(0);
      expect(report.numPassedTests).toBeGreaterThanOrEqual(7);
      // Existing prose acceptance gate stays strict: these tests never claim full journey fidelity.
      expect(reconcileJourneyTests(report,[{id:'journey_product'}])[0]?.result).toBe('failed');
    }
    await run(process.execPath,[path.resolve('app-template/node_modules/typescript/bin/tsc'),'--noEmit'],{cwd:directory,timeout:15000});
  });
},60000);

it('rejects broken action controls, lost persistence, hidden fields and missing create without rewriting tests',async()=>{
  await generatedFixture('book',async(_directory,source)=>{
    for(const mutation of ['inert-action','lost-persistence','hidden-value','missing-create'] as const){
      const report=await source('list',mutation);
      expect(report.numFailedTests,mutation).toBeGreaterThan(0);
    }
  });
},60000);

it('refuses unsupported action sample reachability instead of emitting vacuous passing tests',()=>{
  const contract=executableContract(publicCollectionSpec('book'));
  contract.actions[0]!.when={equals:{title:'Only a special title'}};
  expect(()=>collectionUiScenarios(contract)).toThrow('lacks reachable sample inputs');
  expect(()=>compileProductSpec(publicCollectionSpec('book'),{compiledUiJourneys:true})).toThrow('explicitly enabled');
  expect(compileProductSpec(publicCollectionSpec('book'),{executableCollection:true}).file_ownership.find(file=>file.path==='src/product/product.test.tsx')?.owner).toBe('AGENT');
});
