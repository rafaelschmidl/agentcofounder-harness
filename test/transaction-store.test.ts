import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { capabilityBlock } from "../src/build-plan/blocks.js";

interface State { capacity: number; reserved: number; allocations: string[] }
const initial = (): State => ({ capacity: 4, reserved: 0, allocations: [] });
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function materialized() {
  const root = await mkdtemp(path.join(os.tmpdir(), "acf-transaction-store-")); roots.push(root);
  for (const id of ["data.local-repository", "domain.transaction", "integration.payment-stub"]) {
    for (const file of capabilityBlock(id)!.materialize({})) {
      const target = path.join(root, file.path); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, file.content);
    }
  }
  const transaction = await import(pathToFileURL(path.join(root, "src/system/transaction.ts")).href);
  const persistence = await import(pathToFileURL(path.join(root, "src/system/repository.ts")).href);
  const payment = await import(pathToFileURL(path.join(root, "src/system/payment.ts")).href);
  const saved = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => { saved.set(key, value); });
  vi.stubGlobal("localStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem });
  const repository = new persistence.LocalStorageRepository("allocations", 1,
    () => ({ state: initial(), completedKeys: [] }),
    (value: unknown) => typeof value === "object" && value !== null && "state" in value && "completedKeys" in value);
  const store = new transaction.TransactionStore(repository);
  return { root, transaction, payment, store, repository, saved, setItem };
}
function reserve(quantity: number, label = "allocation") {
  return (snapshot: State) => {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || snapshot.reserved + quantity > snapshot.capacity) {
      return { error: "Insufficient capacity." };
    }
    return { next: { ...snapshot, reserved: snapshot.reserved + quantity, allocations: [...snapshot.allocations, label] }, value: label };
  };
}

describe("materialized TransactionStore", () => {
  it("typechecks a strict consumer of the actual generated persistence, transaction and payment APIs", async () => {
    const { root } = await materialized();
    const consumer = path.join(root, "consumer.ts");
    await writeFile(consumer, `import { TransactionStore, type TransactionEnvelope, transact, transactOnce } from "./src/system/transaction.js";
import { LocalStorageRepository } from "./src/system/repository.js";
import { simulatePayment, DeterministicPaymentStub, type PaymentProvider } from "./src/system/payment.js";
interface State { capacity: number }
type Envelope = TransactionEnvelope<State>;
const repository = new LocalStorageRepository<Envelope>("state", 1, () => ({ state: { capacity: 2 }, completedKeys: [] }),
  (value: unknown): value is Envelope => typeof value === "object" && value !== null && "state" in value && "completedKeys" in value);
const store = new TransactionStore<State>(repository);
const result = store.commit<string>("intent", snapshot => {
  if (snapshot.capacity < 1) return { error: "No capacity" };
  const payment = simulatePayment({ amountMinor: 100, mode: "succeed", idempotencyKey: "intent" });
  if (!payment.ok) return { error: payment.message };
  return { next: { capacity: snapshot.capacity - 1 }, value: payment.reference };
});
if (result.ok) { const reference: string = result.value; console.log(reference, result.envelope.state.capacity); }
else console.log(result.error);
const provider: PaymentProvider = new DeterministicPaymentStub();
const pending = provider.charge({ amountMinor: 100, mode: "decline", idempotencyKey: "other" });
const candidate = transact<State, number>(store.state, snapshot => ({ next: snapshot, value: 1 }));
const once = transactOnce<State, number>(repository.load(), "legacy", snapshot => ({ next: snapshot, value: 1 }));
void [pending, candidate, once];
`);
    const program = ts.createProgram([consumer], { strict: true, noEmit: true, skipLibCheck: true, types: [],
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
    expect(ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))).toEqual([]);
  });

  it("publishes its next state only after the complete envelope and key are durably saved", async () => {
    const { store, saved, setItem } = await materialized();
    const observedDuringSave: State[] = [];
    setItem.mockImplementation((key, value) => {
      observedDuringSave.push(structuredClone(store.state)); saved.set(key, value);
    });
    const result = store.commit("reserve-1", reserve(2));
    expect(result.ok).toBe(true);
    expect(observedDuringSave).toEqual([initial()]);
    expect(store.state).toEqual({ capacity: 4, reserved: 2, allocations: ["allocation"] });
    expect(JSON.parse(saved.get("allocations")!)).toEqual({ version: 1, value: { state: store.state, completedKeys: ["reserve-1"] } });
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("does not return success or consume a key on a failed save, and retries the same intent exactly once", async () => {
    const { store, transaction, repository, saved, setItem } = await materialized();
    const prior = store.state;
    setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    const failed = store.commit("reserve-1", reserve(2));
    expect(failed).toMatchObject({ ok: false, envelope: { state: prior, completedKeys: [] }, error: expect.stringContaining("Could not save") });
    expect(store.state).toBe(prior);
    expect(saved.size).toBe(0);
    const retried = store.commit("reserve-1", reserve(2));
    expect(retried.ok).toBe(true);
    expect(store.state.reserved).toBe(2);
    const reloaded = new transaction.TransactionStore(repository);
    const unexpected = vi.fn(reserve(2));
    const repeated = reloaded.commit("reserve-1", unexpected);
    expect(repeated).toMatchObject({ ok: false, error: "This transaction was already completed." });
    expect(unexpected).not.toHaveBeenCalled();
    expect(reloaded.state.reserved).toBe(2);
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it("runs preconditions against the latest committed state after another operation changes capacity", async () => {
    const { store, setItem } = await materialized();
    const proposed = reserve(3);
    expect(store.commit("capacity-edit", (snapshot: State) => ({ next: { ...snapshot, capacity: 2 }, value: "edited" })).ok).toBe(true);
    const rejected = store.commit("reserve-1", proposed);
    expect(rejected).toMatchObject({ ok: false, error: "Insufficient capacity." });
    expect(store.state).toEqual({ capacity: 2, reserved: 0, allocations: [] });
    expect(rejected.envelope.completedKeys).toEqual(["capacity-edit"]);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("keeps current state after mutation of a rejected or throwing preparation snapshot", async () => {
    const { store, setItem } = await materialized();
    const rejected = store.commit("rule", (snapshot: State) => {
      snapshot.allocations.push("must not leak"); return { error: "Rule rejected." };
    });
    expect(rejected.ok).toBe(false);
    const threw = store.commit("exception", (snapshot: State) => {
      snapshot.capacity = -1; throw new Error("invalid operation");
    });
    expect(threw).toMatchObject({ ok: false, error: expect.stringContaining("Could not prepare") });
    expect(store.state).toEqual(initial());
    expect(setItem).not.toHaveBeenCalled();
    expect(store.commit("rule", reserve(1)).ok).toBe(true);
  });

  it("rejects a nested commit instead of overwriting an intervening successful mutation", async () => {
    const { store, setItem } = await materialized();
    let nested: unknown;
    const result = store.commit("outer", (_snapshot: State) => {
      nested = store.commit("inner", reserve(1)); return { error: "Stopped." };
    });
    expect(nested).toMatchObject({ ok: false, error: "A change is already being processed." });
    expect(result.ok).toBe(false);
    expect(store.state).toEqual(initial());
    expect(setItem).not.toHaveBeenCalled();
    expect(store.commit("inner", reserve(1)).ok).toBe(true);
  });

  it("composes the actual synchronous payment simulation with rollback and preserves the async provider API", async () => {
    const { store, payment, setItem } = await materialized();
    const preparePayment = (mode: "succeed" | "decline") => (snapshot: State) => {
      const result = payment.simulatePayment({ amountMinor: 1200, mode, idempotencyKey: "intent-1" });
      if (!result.ok) return { error: result.message };
      return { next: { ...snapshot, reserved: 1, allocations: [result.reference] }, value: result.reference };
    };
    const declined = store.commit("intent-1", preparePayment("decline"));
    expect(declined).toMatchObject({ ok: false, error: "The simulated payment was declined." });
    expect(store.state).toEqual(initial());
    expect(setItem).not.toHaveBeenCalled();
    expect(store.commit("intent-1", preparePayment("succeed"))).toMatchObject({ ok: true, value: "stub-intent-1" });
    const provider = new payment.DeterministicPaymentStub();
    for (const mode of ["succeed", "decline"]) {
      const input = { amountMinor: 1200, mode, idempotencyKey: "intent-2" };
      expect(await provider.charge(input)).toEqual(payment.simulatePayment(input));
    }
    expect(payment.simulatePayment({ amountMinor: 0, mode: "succeed", idempotencyKey: "invalid" })).toMatchObject({ ok: false, code: "invalid" });
  });
});
