import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CapabilityBlock, BuildPlan } from '../build-plan/types.js';
import type { ProductSpec } from '../product-spec/types.js';
import { executableContract } from './validate.js';
import { compileInteractionManifest, UI_MANIFEST_PATH, type CompiledUiManifest } from './interaction-manifest.js';

const readSource=(name:string)=>readFileSync(new URL(name,import.meta.url),'utf8');
export const uiJourneysEnabled=(plan:BuildPlan)=>plan.blocks.some(block=>block.id==='verification.collection-ui');
const configSource=(display:unknown)=>`export const display: Record<string,{empty?:string;format?:string;values?:Record<string,string>}> = ${JSON.stringify(display??{})};\n`;
export const COMPILED_UI_JOURNEYS_BLOCK: CapabilityBlock = {
  id:'verification.collection-ui',version:'0.2.0',
  config_schema:{type:'object',additionalProperties:false,required:['contract'],properties:{contract:{type:'object'}}},
  capabilities:['protected-collection-ui-contract-tests'],dependencies:['domain.executable-collection'],conflicts:[],
  owned_files:['src/system/collection-ui.ts','src/system/collection-ui-config.ts','src/product/product.test.tsx','compiled-ui-manifest.json','compiled-ui-coverage.json'],
  exported_interfaces:['collectionUi','collectionValue'],checks:['typed visible journeys through actual App','canonical workflow and field assertions','unsupported journeys stay uncovered'],
  materialize(){return [
    {path:'src/system/collection-ui.ts',content:readSource('./ui-bindings.source.txt')},
    {path:'src/system/collection-ui-config.ts',content:configSource({})},
    {path:'src/product/product.test.tsx',content:`import {it} from 'vitest'; it('interaction manifest is not compiled',()=>{throw new Error('Write ${UI_MANIFEST_PATH} with supported journey steps.');});\n`},
    {path:'compiled-ui-manifest.json',content:'null\n'},
    {path:'compiled-ui-coverage.json',content:'{"status":"uncompiled"}\n'},
  ];},
};
export interface UiCompilation {valid:boolean;errors:string[];unsupportedIds:string[];compiled?:CompiledUiManifest;manifestHash?:string}
/** Once a valid manifest compiles, UI repairs cannot weaken or replace its assertions. */
export async function finalizeUiJourneyFiles(plan:BuildPlan,spec:ProductSpec,directory:string):Promise<UiCompilation|undefined>{
  if(!uiJourneysEnabled(plan))return undefined;
  let result:UiCompilation;
  try {
    const input:unknown=JSON.parse(await readFile(join(directory,UI_MANIFEST_PATH),'utf8'));
    const contract=executableContract(spec);const compiled=compileInteractionManifest(input,contract,spec);
    const canonical=JSON.stringify(compiled.manifest);const manifestHash=createHash('sha256').update(canonical).digest('hex');
    const frozen:unknown=JSON.parse(await readFile(join(directory,'compiled-ui-manifest.json'),'utf8'));
    if(frozen!==null&&JSON.stringify(frozen)!==canonical)throw new Error('The validated interaction manifest is frozen. Repair App/CSS against its retained assertions; do not weaken or replace the manifest.');
    await writeFile(join(directory,'compiled-ui-manifest.json'),canonical+'\n');
    const source=readSource('./ui-tests.source.txt').replace('__COMPILED_CONTRACT__',JSON.stringify(contract)).replace('__COMPILED_MANIFEST__',JSON.stringify(compiled));
    await writeFile(join(directory,'src/product/product.test.tsx'),compiled.journeys.length?source:`import {it} from 'vitest'; it('No supported interaction journeys were declared',()=>{throw new Error('All canonical journeys remain unsupported.');});\n`);
    await writeFile(join(directory,'src/system/collection-ui-config.ts'),configSource(compiled.manifest.display));
    result={valid:true,errors:[],unsupportedIds:compiled.manifest.unsupported.map(item=>item.id),compiled,manifestHash};
  } catch(error){
    const message=error instanceof Error?error.message:String(error);
    result={valid:false,errors:[message],unsupportedIds:[]};
    await writeFile(join(directory,'src/product/product.test.tsx'),`import {it} from 'vitest';it('Interaction manifest validation',()=>{throw new Error(${JSON.stringify(message)});});\n`);
  }
  await writeFile(join(directory,'compiled-ui-coverage.json'),JSON.stringify({status:result.valid?'compiled':'invalid',manifest_hash:result.manifestHash,errors:result.errors,
    observed_programs:result.compiled?.journeys.map(journey=>({id:journey.id,steps:journey.steps})),unsupported:result.compiled?.manifest.unsupported,
    scope:'These programs establish only their executed UI operations and assertions. Semantic fidelity to the original prose is independently evaluated. IDs alone do not establish coverage.'},null,2)+'\n');
  return result;
}
