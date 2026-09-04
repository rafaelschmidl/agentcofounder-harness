import type { FlatCollectionContract } from './contract.js';

export type CollectionExecution = { mode: 'custom'; reason: string } | {
  mode: 'compiled'; entity_id: string; requirement_ids: string[];
  contract: Omit<FlatCollectionContract, 'storageKey'>;
};

export function executableCollectionEnabled(): boolean {
  return process.env.CHALLENGE_EXECUTABLE_COLLECTION === '1';
}
