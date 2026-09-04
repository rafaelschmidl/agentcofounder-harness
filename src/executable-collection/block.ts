import { readFileSync } from 'node:fs';
import type { CapabilityBlock } from '../build-plan/types.js';
import type { FlatCollectionContract } from './contract.js';

export const EXECUTABLE_COLLECTION_BLOCK: CapabilityBlock = {
  id: 'domain.executable-collection', version: '0.1.0',
  config_schema: { type: 'object', additionalProperties: false, required: ['contract'], properties: { contract: { type: 'object' } } },
  capabilities: ['compiled-collection-domain'],
  dependencies: ['ui.collection-controller'], conflicts: [],
  owned_files: ['src/system/executable-collection.ts', 'src/product/domain.ts'],
  exported_interfaces: ['definition', 'recordKeys', 'ProductRecord', 'useProductCollection', 'ProductEditor'],
  checks: ['canonical workflow source/target guards', 'complete-record invariants', 'field/enum validation'],
  materialize(config) {
    const contract = config.contract as FlatCollectionContract;
    const recordKeys = Object.fromEntries([
      ...contract.fields.map((field) => [field.key, field.key]),
      ...Object.keys(contract.hidden ?? {}).map((key) => [key, key]),
      ...Object.entries(contract.canonicalFieldBindings ?? {}),
      ...(contract.canonicalIdentifier ? [[contract.canonicalIdentifier, 'id']] : []),
    ]);
    return [{ path: 'src/system/executable-collection.ts', content: readFileSync(new URL('./contract.ts', import.meta.url), 'utf8') }, {
      path: 'src/product/domain.ts',
      content: `// Compiler-owned executable product semantics. Do not replace this module.
import { createElement, type ReactElement } from "react";
import { compileCollection } from "../system/executable-collection";
import { CollectionEditor, useCollection, type CollectionController, type CollectionItem } from "../system/collection-controller";

export type ProductRecord = CollectionItem;
export const recordKeys = ${JSON.stringify(recordKeys)} as const;
export const definition = compileCollection(${JSON.stringify(contract)});
export function useProductCollection(): CollectionController { return useCollection(definition); }
export function ProductEditor(props: { controller: CollectionController; className?: string; fieldsClassName?: string }): ReactElement {
  return createElement(CollectionEditor, { ...props, definition });
}
`,
    }];
  },
};
