import { Ajv } from "ajv";
import { afterEach, expect, it, vi } from "vitest";
import { productSpecDraftSchema } from "../solution/extensions/product-spec-interpreter.js";
import { compileCollection } from "../src/executable-collection/contract.js";
import { executableContract } from "../src/executable-collection/validate.js";
import { expandProductSpecDraft } from "../src/product-spec/draft.js";
import { replaceDraftValues } from "../src/product-spec/submit.js";
import type { ProductSpec } from "../src/product-spec/types.js";
import { validateProductSpec } from "../src/product-spec/validate.js";
import { BOOK_IDEA, SAAS_IDEA, publicCollectionSpec } from "./fixtures/executable-collection.js";

type Draft = Record<string, any>;
afterEach(() => vi.unstubAllEnvs());

function fixture(kind: "book" | "saas") {
  const spec = publicCollectionSpec(kind);
  const draft: Draft = structuredClone(spec);
  delete draft.source_idea_hash;
  delete draft.source_fragments;
  for (const requirement of draft.requirements) requirement.source_refs = requirement.source_refs.map((reference: { fragment_id: string }) => reference.fragment_id);
  for (const conflict of draft.conflicts) conflict.source_refs = conflict.source_refs.map((reference: { fragment_id: string }) => reference.fragment_id);
  draft.collection_execution.contract.fields = draft.collection_execution.contract.fields.map((field: { key: string; initial?: string }) => field.initial === undefined ? field.key : { key: field.key, initial: field.initial });
  return { spec, draft, idea: kind === "book" ? BOOK_IDEA : SAAS_IDEA };
}

function expand(draft: Draft, spec: ProductSpec, idea: string) {
  const result = expandProductSpecDraft(draft, idea, spec.source_fragments);
  const validated = result.candidate ? validateProductSpec(result.candidate, idea) : undefined;
  return { ...result, validated };
}

it.each(["book", "saas"] as const)("accepts compact %s field IDs at the tool boundary and saves fully validated canonical metadata", (kind) => {
  const { spec, draft, idea } = fixture(kind);
  const retained = structuredClone(draft);
  vi.stubEnv("CHALLENGE_EXECUTABLE_COLLECTION", "1");
  const validateDraft = new Ajv({ strict: true, allErrors: true }).compile(productSpecDraftSchema());
  expect(validateDraft(draft), JSON.stringify(validateDraft.errors)).toBe(true);
  const result = expand(draft, spec, idea);
  expect(result.errors).toEqual([]);
  expect(result.validated?.errors).toEqual([]);
  const expanded = result.validated!.spec!;
  expect(draft).toEqual(retained);
  expect(expanded.entities).toEqual(spec.entities);
  expect(expanded.workflows).toEqual(spec.workflows);
  expect(expanded.requirements).toEqual(spec.requirements);
  const original = compileCollection(executableContract(spec));
  const compact = compileCollection(executableContract(expanded));
  expect(compact.defaults).toEqual(original.defaults);
  expect(compact.validate({})).toEqual(original.validate({}));
  expect(executableContract(expanded).actions).toEqual(executableContract(spec).actions);
  const record = kind === "book"
    ? { id: "one", title: "Earthsea", author: "Le Guin", category: "Fantasy", borrower: "Maya" }
    : { id: "one", title: "Offline mode", customer: "Maya", category: "Feature", priority: "high", status: "planned" };
  expect(compact.validStored(record)).toBe(true);
  expect(compact.validStored(record)).toBe(original.validStored(record));
  if (kind === "saas") expect(executableContract(expanded).fields[3]).toMatchObject({ key: "priority", label: "Priority", type: "select", required: true, initial: "medium", options: [{ value: "low", label: "low" }, { value: "medium", label: "medium" }, { value: "high", label: "high" }] });
});

it("derives revised canonical enum metadata without replacing nonexistent draft options", () => {
  const { spec, draft, idea } = fixture("saas");
  const repaired = replaceDraftValues(draft, [{ path: "/entities/0/fields/3/values", value: ["low", "normal", "high"] }, { path: "/collection_execution/contract/fields/3/initial", value: "normal" }]) as Draft;
  const result = expand(repaired, spec, idea);
  expect(result.validated?.errors).toEqual([]);
  expect(executableContract(result.validated!.spec!).fields[3]!.options?.map((option) => option.value)).toEqual(["low", "normal", "high"]);
  expect(repaired.collection_execution.contract.fields[3]).not.toHaveProperty("options");
});

it.each([
  { required: false },
  { options: [{ value: "urgent", label: "Urgent" }] },
  { options: [] },
  { label: null },
  { type: "number" },
])("preserves explicit contradictory or malformed metadata for rejection: %j", (overrides) => {
  const { spec, draft, idea } = fixture("saas");
  draft.collection_execution.contract.fields[3] = { key: "priority", ...overrides };
  const retained = structuredClone(draft);
  const result = expand(draft, spec, idea);
  expect(result.validated?.valid).toBe(false);
  expect(draft).toEqual(retained);
  expect((result.candidate as ProductSpec).collection_execution).toMatchObject({ contract: { fields: expect.arrayContaining([expect.objectContaining(overrides)]) } });
});

it.each(["unknown", "ambiguous", "identifier"])("rejects %s shorthand without choosing an alias or editable generated identifier", (kind) => {
  const { spec, draft, idea } = fixture("book");
  if (kind === "unknown") draft.collection_execution.contract.fields[0] = "Title";
  if (kind === "ambiguous") draft.entities[0].fields.push(structuredClone(draft.entities[0].fields[0]));
  if (kind === "identifier") draft.entities[0].fields[0].type = "identifier";
  const result = expand(draft, spec, idea);
  expect(result.candidate).toBeUndefined();
  expect(result.errors.join(" ")).toMatch(/exact, unique|canonical type identifier/u);
});

it("retains valid field presentation overrides and action-specific required semantics", () => {
  const { spec, draft, idea } = fixture("book");
  draft.collection_execution.contract.fields[0] = { key: "title", label: "Book title", type: "textarea", placeholder: "Enter a title" };
  const result = expand(draft, spec, idea);
  expect(result.validated?.errors).toEqual([]);
  const contract = executableContract(result.validated!.spec!);
  expect(contract.fields[0]).toMatchObject({ label: "Book title", type: "textarea", placeholder: "Enter a title", required: true });
  expect(contract.hidden!.borrower!.required).toBe(false);
  expect(contract.actions[0]!.input![0]!.required).toBe(true);
});

it("does not make shorthand canonical or relax action-input label and workflow-state validation", () => {
  const { spec, draft, idea } = fixture("book");
  const canonical = structuredClone(spec) as Draft;
  canonical.collection_execution.contract.fields = ["title", "author", "category"];
  expect(validateProductSpec(canonical, idea).valid).toBe(false);
  vi.stubEnv("CHALLENGE_EXECUTABLE_COLLECTION", "1");
  delete draft.collection_execution.contract.actions[0].input[0].label;
  const validateDraft = new Ajv({ strict: true }).compile(productSpecDraftSchema());
  expect(validateDraft(draft)).toBe(false);
  const stateDraft = fixture("book").draft;
  delete stateDraft.collection_execution.contract.hidden.borrower;
  stateDraft.collection_execution.contract.fields.push("borrower");
  expect(expand(stateDraft, spec, idea).validated?.errors.join(" ")).toContain("state guards must use declared hidden fields");
});
