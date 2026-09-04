import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalStorageRepository } from "../system/repository";

type Item = { id: string; title: string; borrower: string };
const key = "same-records-across-tests";
const nativeSetItem = Storage.prototype.setItem;
const nativeClear = Storage.prototype.clear;
const nativeStorage = localStorage;

function repository() {
  return new LocalStorageRepository<Item[]>(key, 1, () => [],
    (value): value is Item[] => Array.isArray(value) && value.every((item) =>
      typeof item.id === "string" && typeof item.title === "string" && typeof item.borrower === "string"));
}

function ReloadedCollection() {
  const [items] = useState(() => repository().load());
  return <ul>{items.map((item) => <li key={item.id}>{item.title} · {item.borrower}</li>)}</ul>;
}

// No local hooks: every reset and restoration must come from compiled setup.ts.
describe.sequential("real materialized test isolation", () => {
  it.each([1, 2])("starts clean and retains the same record across a reload within test %i", () => {
    expect(repository().load()).toEqual([]);
    expect(sessionStorage.getItem(key)).toBeNull();
    repository().save([{ id: "same-id", title: "Shared title", borrower: "Jo" }]);
    sessionStorage.setItem(key, "session value");
    const view = render(<ReloadedCollection />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("Shared title · Jo");
    view.unmount();
    render(<ReloadedCollection />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("Shared title · Jo");
    expect(sessionStorage.getItem(key)).toBe("session value");
  });

  it("can simulate a failed save without manually restoring the storage spies or global stub", () => {
    expect(repository().load()).toEqual([]);
    repository().save([{ id: "same-id", title: "Before failure", borrower: "Sam" }]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    vi.spyOn(Storage.prototype, "clear").mockImplementation(() => { throw new Error("Mock clear"); });
    expect(() => repository().save([])).toThrow("Full");
    expect(repository().load()).toEqual([{ id: "same-id", title: "Before failure", borrower: "Sam" }]);
    vi.stubGlobal("localStorage", { clear: () => { throw new Error("Leaked global stub"); } });
  });

  it("restores the real methods and storage object before the next test starts", () => {
    expect(localStorage).toBe(nativeStorage);
    expect(Storage.prototype.setItem).toBe(nativeSetItem);
    expect(Storage.prototype.clear).toBe(nativeClear);
    expect(repository().load()).toEqual([]);
    repository().save([{ id: "same-id", title: "Fresh", borrower: "Lee" }]);
    expect(repository().load()).toEqual([{ id: "same-id", title: "Fresh", borrower: "Lee" }]);
  });
});
