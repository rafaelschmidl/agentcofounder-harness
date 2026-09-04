/** Optional local collection behavior; the product owns rules, composition, and visual identity. */
export const COLLECTION_CONTROLLER_SOURCE = `import { useEffect, useRef, useState, type ReactElement } from "react";
import { RecordForm, type RecordField, type FormResult } from "./record-form";
import { LocalStorageRepository } from "./repository";

export type CollectionValues = Record<string, string>;
export type CollectionErrors = Partial<Record<string, string>>;
export type CollectionItem = CollectionValues & { id: string };
export type CollectionActionResult =
  | { ok: true; patch: CollectionValues; message: string }
  | { ok: false; errors: CollectionErrors; message?: string };

export interface CollectionAction {
  id: string;
  label: string;
  available: (record: CollectionItem) => boolean;
  fields?: readonly RecordField<string>[];
  initialValues?: CollectionValues;
  apply: (record: CollectionItem, input: CollectionValues) => CollectionActionResult;
}

export interface CollectionDefinition {
  storageKey: string;
  version?: number;
  noun: string;
  titleKey: string;
  fields: readonly RecordField<string>[];
  defaults: CollectionValues;
  validate: (values: CollectionValues) => CollectionErrors;
  validStored: (record: CollectionItem) => boolean;
  actions: readonly CollectionAction[];
}

export type CollectionEditorState = { kind: "create" }
  | { kind: "edit"; id: string }
  | { kind: "action"; id: string; actionId: string };

export interface CollectionController {
  records: CollectionItem[];
  editor: CollectionEditorState | null;
  notice: { tone: "success" | "error"; text: string } | null;
  startCreate: () => void;
  startEdit: (record: CollectionItem) => void;
  cancel: () => void;
  remove: (record: CollectionItem) => void;
  act: (record: CollectionItem, actionId: string) => void;
  submit: (values: CollectionValues) => FormResult<string>;
}

function validRecord(definition: CollectionDefinition, candidate: unknown): candidate is CollectionItem {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const record = candidate as CollectionItem;
  return typeof record.id === "string" && record.id.length > 0 &&
    Object.values(record).every((value) => typeof value === "string") &&
    Object.keys(definition.defaults).every((key) => typeof record[key] === "string") &&
    !Object.values(definition.validate({ ...record })).some(Boolean) && definition.validStored({ ...record });
}

export function prepareCollectionAction(definition: CollectionDefinition, actionId: string, record: CollectionItem, input: CollectionValues): CollectionActionResult {
  const action = definition.actions.find((entry) => entry.id === actionId);
  if (!action || !action.available({ ...record })) return { ok: false, errors: {}, message: "That action is no longer available." };
  // Flat string records make shallow copies sufficient to isolate domain code.
  const result = action.apply({ ...record }, { ...input });
  if (result.ok && !validRecord(definition, { ...record, ...result.patch, id: record.id })) {
    return { ok: false, errors: {}, message: "That change would leave an invalid item. Your original item is unchanged." };
  }
  return result;
}

// Keep the definition at module scope. To switch independent collections, remount
// the owning component with a key; this hook owns one canonical saved collection.
export function useCollection(definition: CollectionDefinition): CollectionController {
  const [initial] = useState(() => {
    let recovered = false;
    const repository = new LocalStorageRepository<CollectionItem[]>(definition.storageKey, definition.version ?? 1, () => [],
      (value): value is CollectionItem[] => Array.isArray(value) && value.every((record) => validRecord(definition, record)) && new Set(value.map((record) => record.id)).size === value.length,
      () => { recovered = true; });
    const records = repository.load();
    return { repository, records, recovered };
  });
  const [records, setRecords] = useState(initial.records);
  const canonical = useRef(initial.records);
  const [editor, setEditor] = useState<CollectionEditorState | null>(null);
  const [notice, setNotice] = useState<CollectionController["notice"]>(initial.recovered ? { tone: "error", text: "Saved items could not be loaded. An empty collection is shown." } : null);
  function persist(next: CollectionItem[], message: string): FormResult<string> {
    try { initial.repository.save(next); }
    catch {
      const text = "Could not save your changes. Your saved items are unchanged; try again when browser storage is available.";
      setNotice({ tone: "error", text });
      return { ok: false, errors: {}, message: text };
    }
    canonical.current = next;
    setRecords(next);
    setNotice({ tone: "success", text: message });
    return { ok: true };
  }
  function submit(values: CollectionValues): FormResult<string> {
    if (!editor) return { ok: false, errors: {}, message: "Open a form first." };
    const current = canonical.current;
    const selected = "id" in editor ? current.find((record) => record.id === editor.id) : undefined;
    const action = editor.kind === "action" ? definition.actions.find((entry) => entry.id === editor.actionId) : undefined;
    const clean = Object.fromEntries((action?.fields ?? definition.fields).map((field) => [field.key, (values[field.key] ?? "").trim()]));
    let result: FormResult<string>;
    if (editor.kind === "action") {
      if (!selected) return { ok: false, errors: {}, message: "This item no longer exists." };
      const change = prepareCollectionAction(definition, editor.actionId, selected, clean);
      if (!change.ok) return change;
      result = persist(current.map((record) => record.id === selected.id ? { ...record, ...change.patch, id: record.id } : record), change.message);
    } else {
      const errors = definition.validate({ ...clean });
      if (Object.values(errors).some(Boolean)) return { ok: false, errors };
      if (editor.kind === "edit" && !selected) return { ok: false, errors: {}, message: "This item no longer exists." };
      const next = selected ? { ...selected, ...clean, id: selected.id } : { ...definition.defaults, ...clean, id: crypto.randomUUID() };
      if (!validRecord(definition, next)) return { ok: false, errors: {}, message: "These details would create an invalid item. Review them and try again." };
      result = persist(selected ? current.map((record) => record.id === selected.id ? next : record) : [...current, next], selected ? "Changes saved." : "Added " + definition.noun + ".");
    }
    if (result.ok) setEditor(null);
    return result;
  }
  return {
    records, editor, notice, submit,
    startCreate: () => { setNotice(null); setEditor({ kind: "create" }); },
    startEdit: (record) => { setNotice(null); setEditor({ kind: "edit", id: record.id }); },
    cancel: () => setEditor(null),
    remove: (record) => {
      const result = persist(canonical.current.filter((entry) => entry.id !== record.id), "Removed " + definition.noun + ".");
      if (result.ok && editor && "id" in editor && editor.id === record.id) setEditor(null);
    },
    act: (record, actionId) => {
      const current = canonical.current.find((entry) => entry.id === record.id);
      const action = definition.actions.find((entry) => entry.id === actionId);
      if (!current || !action || !action.available({ ...current })) { setNotice({ tone: "error", text: "That action is no longer available." }); return; }
      if (action.fields?.length) { setNotice(null); setEditor({ kind: "action", id: record.id, actionId }); return; }
      const result = prepareCollectionAction(definition, actionId, current, {});
      if (!result.ok) { setNotice({ tone: "error", text: result.message ?? "Could not apply that action." }); return; }
      persist(canonical.current.map((entry) => entry.id === record.id ? { ...entry, ...result.patch, id: entry.id } : entry), result.message);
    },
  };
}

export function CollectionEditor({ definition, controller, className, fieldsClassName = "form-grid" }: {
  definition: CollectionDefinition;
  controller: CollectionController;
  className?: string;
  fieldsClassName?: string;
}): ReactElement | null {
  const { editor, records } = controller;
  const formRoot = useRef<HTMLDivElement>(null);
  const editorKey = JSON.stringify(editor);
  useEffect(() => { formRoot.current?.querySelector<HTMLInputElement>("input, select, textarea")?.focus(); }, [editorKey]);
  if (!editor) return null;
  const selected = "id" in editor ? records.find((record) => record.id === editor.id) : undefined;
  const action = editor.kind === "action" ? definition.actions.find((entry) => entry.id === editor.actionId) : undefined;
  const title = action ? action.label + ": " + selected?.[definition.titleKey] : editor.kind === "edit" ? "Edit " + definition.noun : "Add " + definition.noun;
  const initialValues = action ? Object.fromEntries((action.fields ?? []).map((field) => [field.key, action.initialValues?.[field.key] ?? ""])) : selected ?? definition.defaults;
  return <div ref={formRoot}><RecordForm key={editorKey} className={className} fieldsClassName={fieldsClassName} fields={action?.fields ?? definition.fields}
    initialValues={initialValues} title={title} ariaLabel={title}
    submitLabel={action?.label ?? (editor.kind === "edit" ? "Save changes" : "Add " + definition.noun)} onSubmit={controller.submit}
    actions={<button type="button" onClick={controller.cancel}>Cancel</button>} /></div>;
}
`;
