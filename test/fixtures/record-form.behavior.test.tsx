import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RecordForm, type RecordField, type FormResult } from "../system/record-form";

const fields: readonly RecordField<"name">[] = [{ key: "name", label: "Name" }];

const stockFields: readonly RecordField<"price" | "stock">[] = [
  { key: "price", label: "Price", type: "number" },
  { key: "stock", label: "Stock", type: "number" },
];
const originalStock = { price: "18", stock: "12" };
const storageKey = "record-form-saved-product";

// A still-open editor retains its accepted values. The saved record and success
// notice belong to the caller; only publish either after persistence succeeds.
function RetainedEditor() {
  const [saved, setSaved] = useState(originalStock);
  const [notice, setNotice] = useState("");
  function submit(values: typeof originalStock): FormResult<"price" | "stock"> {
    setNotice("");
    try { localStorage.setItem(storageKey, JSON.stringify(values)); }
    catch { return { ok: false, errors: {}, message: "Could not save. The saved record is unchanged." }; }
    setSaved(values);
    setNotice("Changes saved.");
    return { ok: true };
  }
  return <>
    {notice ? <p role="status">{notice}</p> : null}
    <section aria-label="Saved product">Price {saved.price}; stock {saved.stock}</section>
    <RecordForm fields={stockFields} initialValues={originalStock} ariaLabel="Edit product"
      submitLabel="Save changes" onSubmit={submit} />
  </>;
}

describe("materialized RecordForm behavior", () => {
  it("preserves failed input and connects domain errors to the correct control", async () => {
    const user = userEvent.setup();
    render(<RecordForm fields={fields} initialValues={{ name: "" }} ariaLabel="Create record"
      submitLabel="Save" resetOnSuccess onSubmit={() => ({ ok: false, errors: { name: "That name is already used." } })} />);
    await user.type(screen.getByLabelText("Name"), "Existing record");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const input = screen.getByLabelText("Name");
    const alert = screen.getByRole("alert");
    expect(input).toHaveValue("Existing record");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
    expect(input).toHaveFocus();
    expect(alert).toHaveTextContent("That name is already used.");
  });

  it("resets after success only when requested, and passes the draft to the domain callback", async () => {
    const user = userEvent.setup();
    const submit = vi.fn((_values: Record<"name", string>): FormResult<"name"> => ({ ok: true }));
    render(<><RecordForm fields={fields} initialValues={{ name: "" }} ariaLabel="Resetting form"
      submitLabel="Save" resetOnSuccess onSubmit={submit} />
      <RecordForm fields={fields} initialValues={{ name: "" }} ariaLabel="Retaining form"
        submitLabel="Save" onSubmit={submit} /></>);
    const reset = within(screen.getByRole("form", { name: "Resetting form" }));
    const retain = within(screen.getByRole("form", { name: "Retaining form" }));
    await user.type(reset.getByLabelText("Name"), "New record");
    await user.click(reset.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenLastCalledWith({ name: "New record" });
    expect(reset.getByLabelText("Name")).toHaveValue("");
    await user.type(retain.getByLabelText("Name"), "Keep draft");
    await user.click(retain.getByRole("button", { name: "Save" }));
    expect(retain.getByLabelText("Name")).toHaveValue("Keep draft");
    expect(reset.getByLabelText("Name").id).not.toBe(retain.getByLabelText("Name").id);
  });

  it("keeps an edited draft across rerenders and resets values and errors when switching records by key", async () => {
    const user = userEvent.setup();
    const invalid = (): FormResult<"name"> => ({ ok: false, errors: { name: "Name is required." } });
    const view = render(<RecordForm key="first" fields={fields} initialValues={{ name: "First record" }}
      ariaLabel="Edit record" submitLabel="Save" onSubmit={invalid} />);
    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    view.rerender(<RecordForm key="first" fields={fields} initialValues={{ name: "First record" }}
      ariaLabel="Edit record" submitLabel="Save" onSubmit={invalid} />);
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required.");

    view.rerender(<RecordForm key="second" fields={fields} initialValues={{ name: "Second record" }}
      ariaLabel="Edit record" submitLabel="Save" onSubmit={invalid} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Second record");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "false");
  });

  it("preserves a saved stock change when the still-open editor next changes only price", async () => {
    const user = userEvent.setup();
    render(<RetainedEditor />);
    await user.clear(screen.getByLabelText("Stock"));
    await user.type(screen.getByLabelText("Stock"), "11");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("region", { name: "Saved product" })).toHaveTextContent("Price 18; stock 11");
    expect(screen.getByLabelText("Stock")).toHaveValue(11);

    await user.clear(screen.getByLabelText("Price"));
    await user.type(screen.getByLabelText("Price"), "20");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("region", { name: "Saved product" })).toHaveTextContent("Price 20; stock 11");
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ price: "20", stock: "11" });
    expect(screen.getByLabelText("Price")).toHaveValue(20);
    expect(screen.getByLabelText("Stock")).toHaveValue(11);
  });

  it("replaces prior success with a real save failure, preserves the draft and saved record, then retries", async () => {
    const user = userEvent.setup();
    render(<RetainedEditor />);
    await user.clear(screen.getByLabelText("Stock"));
    await user.type(screen.getByLabelText("Stock"), "11");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("status")).toHaveTextContent("Changes saved.");
    const savedBytes = localStorage.getItem(storageKey);
    await user.clear(screen.getByLabelText("Price"));
    await user.type(screen.getByLabelText("Price"), "20");
    const failingSave = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    });
    try {
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      expect(failingSave).toHaveBeenCalledExactlyOnceWith(storageKey, JSON.stringify({ price: "20", stock: "11" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Could not save.");
      expect(screen.getByRole("region", { name: "Saved product" })).toHaveTextContent("Price 18; stock 11");
      expect(localStorage.getItem(storageKey)).toBe(savedBytes);
      expect(screen.getByLabelText("Price")).toHaveValue(20);
      expect(screen.getByLabelText("Stock")).toHaveValue(11);
    } finally { failingSave.mockRestore(); }

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("status")).toHaveTextContent("Changes saved.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Saved product" })).toHaveTextContent("Price 20; stock 11");
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ price: "20", stock: "11" });
  });
});
