import { COLLECTION_EXECUTION_SCHEMA } from "../executable-collection/schema.js";

type ObjectValue = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectValue => typeof value === "object" && value !== null && !Array.isArray(value);

/** Only the input draft accepts shorthand; the saved canonical schema stays strict. */
export function collectionExecutionDraftSchema(): Record<string, unknown> {
  const schema = structuredClone(COLLECTION_EXECUTION_SCHEMA);
  const contract = schema.anyOf[1]!.properties.contract as { properties: Record<string, unknown> };
  const fields = contract.properties.fields as { items: { required: string[] }; [key: string]: unknown };
  const field = structuredClone(fields.items);
  field.required = field.required.filter((key) => key !== "label");
  contract.properties.fields = { ...fields, items: { anyOf: [
    { type: "string", minLength: 1, description: "Exact canonical entity field ID; display and validation metadata are derived" },
    field,
  ] } };
  return schema;
}

/** Derive omitted metadata only from an exact, unique canonical field ID. */
export function expandCollectionExecutionDraft(execution: unknown, entities: unknown, errors: string[]): unknown {
  if (!isObject(execution) || execution.mode !== "compiled" || !isObject(execution.contract) || !Array.isArray(execution.contract.fields)) return execution;
  const result = structuredClone(execution);
  const contract = result.contract as ObjectValue;
  const matches = Array.isArray(entities) ? entities.filter((entity) => isObject(entity) && entity.id === execution.entity_id) : [];
  const canonical = matches.length === 1 && isObject(matches[0]) && Array.isArray(matches[0].fields) ? matches[0].fields : [];
  contract.fields = execution.contract.fields.map((item, index) => {
    const shorthand = typeof item === "string";
    const field = shorthand ? { key: item } : isObject(item) ? structuredClone(item) : undefined;
    if (!field) return item;
    const candidates = canonical.filter((candidate) => isObject(candidate) && candidate.id === field.key);
    const source = candidates.length === 1 && isObject(candidates[0]) ? candidates[0] : undefined;
    if (!source) {
      if (shorthand || !Object.hasOwn(field, "label")) errors.push(`collection_execution.contract.fields[${index}] requires an exact, unique canonical entity field ID: ${String(field.key)}`);
      return field;
    }
    if (!["string", "enum"].includes(String(source.type))) {
      errors.push(`collection_execution.contract.fields[${index}] cannot derive editable field ${String(field.key)} with canonical type ${String(source.type)}; preserve the canonical type and use custom mode if needed`);
      return field;
    }
    // Never repair away an explicit value, including null, false or empty lists.
    if (!Object.hasOwn(field, "label")) field.label = source.name;
    if (!Object.hasOwn(field, "type")) field.type = source.type === "enum" ? "select" : "text";
    if (!Object.hasOwn(field, "required")) field.required = source.required;
    if (source.type === "enum" && !Object.hasOwn(field, "options") && Array.isArray(source.values)) {
      field.options = source.values.map((value) => ({ value, label: value }));
    }
    return field;
  });
  return result;
}
