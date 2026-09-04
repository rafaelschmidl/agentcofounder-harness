import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecordForm, type RecordField, type FormResult } from "../system/record-form";

const fields: readonly RecordField<"name">[] = [{ key: "name", label: "Name" }];

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
});
