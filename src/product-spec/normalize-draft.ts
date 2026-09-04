type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value);

export interface DraftContainerMove { from: string; to: string }

/** Recover root-only properties accidentally nested in product, without choosing between values. */
export function normalizeDraftContainer(draft: unknown, schema: ObjectValue): { draft: unknown; moves: DraftContainerMove[] } {
  const unchanged = { draft, moves: [] };
  if (!object(draft) || !object(draft.product) || !object(schema.properties)) return unchanged;
  const productSchema = schema.properties.product;
  if (!object(productSchema) || !object(productSchema.properties)) return unchanged;
  const rootKeys = new Set(Object.keys(schema.properties));
  const productKeys = new Set(Object.keys(productSchema.properties));
  const misplaced = Object.keys(draft.product).filter((key) => !productKeys.has(key));
  if (!misplaced.length || misplaced.some((key) => !rootKeys.has(key) || Object.hasOwn(draft, key))) return unchanged;
  // All moves are lossless and unambiguous or none occur. Strict schema validation still follows.
  const normalized = structuredClone(draft);
  const product = normalized.product as ObjectValue;
  for (const key of misplaced) { normalized[key] = product[key]; delete product[key]; }
  return { draft: normalized, moves: misplaced.map((key) => ({ from: `/product/${key}`, to: `/${key}` })) };
}
