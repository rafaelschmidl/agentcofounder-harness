import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CollectionEditor, prepareCollectionAction, useCollection, type CollectionDefinition } from "../system/collection-controller";

const definition: CollectionDefinition = {
  storageKey: "controller-regression", noun: "record", titleKey: "title",
  fields: [{ key: "title", label: "Title" }],
  defaults: { title: "", state: "available", borrower: "" },
  validate: (values) => values.title?.trim() ? {} : { title: "A title is required." },
  validStored: (record) => record.state === "available" ? record.borrower === "" : record.state === "lent" && !!record.borrower.trim(),
  actions: [{ id: "lend", label: "Lend", available: (record) => record.state === "available", fields: [{ key: "borrower", label: "Borrower" }],
    apply: (_record, values) => values.borrower ? { ok: true, patch: { state: "lent", borrower: values.borrower }, message: "Lent." } : { ok: false, errors: { borrower: "A borrower is required." } },
  }, { id: "return", label: "Return", available: (record) => record.state === "lent", apply: () => ({ ok: true, patch: { state: "available", borrower: "" }, message: "Returned." }) }],
};

function TestApp() {
  const controller = useCollection(definition);
  return <main><button onClick={controller.startCreate}>New record</button>
    {controller.notice ? <p role={controller.notice.tone === "error" ? "alert" : "status"}>{controller.notice.text}</p> : null}
    <CollectionEditor definition={definition} controller={controller} />
    <ul>{controller.records.map((record) => <li aria-label={record.title} key={record.id}>
      <span>{record.title} · {record.state} · {record.borrower}</span>
      <button onClick={() => controller.startEdit(record)}>Edit {record.title}</button>
      <button onClick={() => controller.remove(record)}>Delete {record.title}</button>
      <button onClick={() => controller.act(record, record.state === "lent" ? "return" : "lend")}>{record.state === "lent" ? "Return " : "Lend "}{record.title}</button>
      <button onClick={() => { controller.act(record, "return"); controller.act(record, "return"); }}>Return twice {record.title}</button>
    </li>)}</ul>
  </main>;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

async function create(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole("button", { name: "New record" }));
  await user.type(screen.getByLabelText("Title"), title);
  await user.click(screen.getByRole("button", { name: "Add record" }));
}

describe("actual materialized collection controller", () => {
  it("exposes exact create, edit and action form names and commits input-free actions without a form", async () => {
    const user = userEvent.setup(); render(<TestApp />);
    await user.click(screen.getByRole("button", { name: "New record" }));
    const createForm = screen.getByRole("form", { name: "Add record" });
    await user.type(within(createForm).getByLabelText("Title"), "Exact title");
    await user.click(within(createForm).getByRole("button", { name: "Add record" }));
    await user.click(screen.getByRole("button", { name: "Edit Exact title" }));
    const editForm = screen.getByRole("form", { name: "Edit record" });
    await user.click(within(editForm).getByRole("button", { name: "Save changes" }));
    await user.click(screen.getByRole("button", { name: "Lend Exact title" }));
    const actionForm = screen.getByRole("form", { name: "Lend: Exact title" });
    await user.type(within(actionForm).getByLabelText("Borrower"), "Jo");
    await user.click(within(actionForm).getByRole("button", { name: "Lend" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Return Exact title" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Exact title" })).toHaveTextContent("available");
    expect(screen.getByRole("status")).toHaveTextContent("Returned.");
  });

  it("keeps invalid drafts, creates and reloads records, and remounts when the selected editor changes", async () => {
    const user = userEvent.setup(); const view = render(<TestApp />);
    await user.click(screen.getByRole("button", { name: "New record" }));
    await user.click(screen.getByRole("button", { name: "Add record" }));
    expect(screen.getByLabelText("Title")).toHaveFocus();
    expect(screen.getByLabelText("Title")).toHaveAccessibleDescription("A title is required.");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "First");
    await user.click(screen.getByRole("button", { name: "Add record" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    await create(user, "Second");
    await user.click(screen.getByRole("button", { name: "Edit First" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(screen.getByRole("button", { name: "Edit Second" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Second");
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "false");
    view.unmount(); render(<TestApp />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("validates actions, preserves hidden state during editing, applies guarded transitions and persists deletion", async () => {
    const user = userEvent.setup(); const view = render(<TestApp />);
    await create(user, "First");
    await user.click(screen.getByRole("button", { name: "Lend First" }));
    expect(screen.getByLabelText("Borrower")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Lend" }));
    expect(screen.getByLabelText("Borrower")).toHaveAccessibleDescription("A borrower is required.");
    expect(screen.getByRole("listitem", { name: "First" })).toHaveTextContent("available");
    await user.type(screen.getByLabelText("Borrower"), "Jo");
    await user.click(screen.getByRole("button", { name: "Lend" }));
    await user.click(screen.getByRole("button", { name: "Edit First" }));
    await user.clear(screen.getByLabelText("Title")); await user.type(screen.getByLabelText("Title"), "Renamed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("listitem", { name: "Renamed" })).toHaveTextContent("lent · Jo");
    const save = vi.spyOn(Storage.prototype, "setItem");
    await user.click(screen.getByRole("button", { name: "Return twice Renamed" }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
    expect(screen.getByRole("listitem", { name: "Renamed" })).toHaveTextContent("available");
    expect(screen.getByRole("listitem", { name: "Renamed" })).not.toHaveTextContent("Jo");
    await user.click(screen.getByRole("button", { name: "Delete Renamed" }));
    view.unmount(); render(<TestApp />);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("saves before updating canonical state and preserves failed edits, actions and deletions", async () => {
    const user = userEvent.setup(); render(<TestApp />); await create(user, "First");
    const saved = localStorage.getItem(definition.storageKey);
    const save = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await user.click(screen.getByRole("button", { name: "Edit First" }));
    await user.clear(screen.getByLabelText("Title")); await user.type(screen.getByLabelText("Title"), "Edited");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Edited");
    expect(within(screen.getByRole("form", { name: "Edit record" })).getByRole("alert")).toHaveTextContent("Could not save");
    expect(screen.getByRole("listitem", { name: "First" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Lend First" }));
    await user.type(screen.getByLabelText("Borrower"), "Jo");
    await user.click(screen.getByRole("button", { name: "Lend" }));
    expect(screen.getByLabelText("Borrower")).toHaveValue("Jo");
    expect(screen.getByRole("listitem", { name: "First" })).toHaveTextContent("available");
    await user.click(screen.getByRole("button", { name: "Delete First" }));
    expect(screen.getByRole("listitem", { name: "First" })).toBeVisible();
    expect(localStorage.getItem(definition.storageKey)).toBe(saved);
    save.mockRestore();
    await user.click(screen.getByRole("button", { name: "Lend" }));
    expect(screen.getByRole("listitem", { name: "First" })).toHaveTextContent("lent · Jo");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it.each([
    "not json",
    JSON.stringify({ version: 1, value: [{ id: "bad", title: "Bad", state: "lent", borrower: "" }] }),
    JSON.stringify({ version: 1, value: [{ id: "same", title: "One", state: "available", borrower: "" }, { id: "same", title: "Two", state: "available", borrower: "" }] }),
  ])("reports recovery for corrupt or domain-invalid stored data: %s", (raw) => {
    localStorage.setItem(definition.storageKey, raw);
    render(<TestApp />);
    expect(screen.getByRole("alert")).toHaveTextContent("Saved items could not be loaded");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("isolates failed impure domain code and rejects invalid action patches", () => {
    const original = { id: "one", title: "Original", state: "available", borrower: "" };
    const impure: CollectionDefinition = { ...definition, actions: [{ id: "bad", label: "Bad", available: () => true, apply: (record) => { record.title = "Mutated"; return { ok: false, errors: {}, message: "Rejected" }; } }] };
    expect(prepareCollectionAction(impure, "bad", original, {})).toMatchObject({ ok: false });
    expect(original.title).toBe("Original");
    const invalid = { ...definition, actions: [{ id: "bad", label: "Bad", available: () => true, apply: () => ({ ok: true as const, patch: { state: "lent", borrower: "" }, message: "Invalid" }) }] };
    expect(prepareCollectionAction(invalid, "bad", original, {})).toMatchObject({ ok: false });
    expect(prepareCollectionAction(definition, "return", original, {})).toMatchObject({ ok: false });
  });
});
