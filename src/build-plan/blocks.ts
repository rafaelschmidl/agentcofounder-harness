import type { CapabilityBlock, MaterializedFile } from "./types.js";
import { EXECUTABLE_COLLECTION_BLOCK } from "../executable-collection/block.js";
import { RECORD_FORM_SOURCE } from "./record-form.js";
import { COLLECTION_CONTROLLER_SOURCE } from "./collection-controller.js";

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});

function foundationFiles(config: Record<string, unknown>): MaterializedFile[] {
  const productSummary = typeof config.product_summary === "string" ? config.product_summary.trim()
    : typeof config.product_name === "string" ? config.product_name.trim() : "Your collection";
  // The interpreted summary may contain the entire brief. Keep it available as
  // context while preventing it from becoming a paragraph-sized product title.
  const normalized = (typeof config.product_name === "string" ? config.product_name : productSummary).replace(/\s+/gu, " ") || "Your collection";
  const productName = normalized.length <= 56
    ? normalized
    : `${normalized.slice(0, 53).replace(/\s+\S*$/u, "").trimEnd()}…`;
  return [
    {
      path: "src/system/product.ts",
      content: `export const PRODUCT_NAME = ${JSON.stringify(productName)};
export const PRODUCT_SUMMARY = ${JSON.stringify(productSummary)};
`,
    },
    {
      path: "src/test/setup.ts",
      content: `import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  try {
    cleanup();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
`,
    },
  ];
}

function repositoryFiles(): MaterializedFile[] {
  return [
    {
      path: "src/system/repository.ts",
      content: `export interface Repository<T> {
  load(): T;
  save(value: T): void;
}

interface StoredEnvelope<T> {
  version: number;
  value: T;
}

export class LocalStorageRepository<T> implements Repository<T> {
  constructor(
    private readonly key: string,
    private readonly version: number,
    private readonly fallback: () => T,
    private readonly isValid: (value: unknown) => value is T,
    private readonly onRecovery?: () => void,
  ) {}

  load(): T {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw === null) return this.fallback();
      const envelope = JSON.parse(raw) as Partial<StoredEnvelope<unknown>>;
      if (envelope.version !== this.version || !this.isValid(envelope.value)) {
        return this.recover();
      }
      return envelope.value;
    } catch {
      return this.recover();
    }
  }

  save(value: T): void {
    localStorage.setItem(this.key, JSON.stringify({ version: this.version, value }));
  }

  private recover(): T {
    this.onRecovery?.();
    const value = this.fallback();
    try {
      this.save(value);
    } catch {
      // The valid in-memory fallback remains usable when storage is unavailable.
    }
    return value;
  }
}
`,
    },
  ];
}

function collectionFiles(): MaterializedFile[] {
  return [
    {
      path: "src/system/collection.ts",
      content: `export interface Identified {
  id: string;
}

export function upsertRecord<T extends Identified>(records: readonly T[], next: T): T[] {
  const index = records.findIndex((record) => record.id === next.id);
  if (index < 0) return [...records, next];
  return records.map((record, recordIndex) => (recordIndex === index ? next : record));
}

export function removeRecord<T extends Identified>(records: readonly T[], id: string): T[] {
  return records.filter((record) => record.id !== id);
}

export function countWhere<T>(records: readonly T[], predicate: (record: T) => boolean): number {
  return records.reduce((count, record) => count + (predicate(record) ? 1 : 0), 0);
}
`,
    },
  ];
}

function workflowFiles(): MaterializedFile[] {
  return [
    {
      path: "src/system/workflow.ts",
      content: `export interface Transition<State extends string> {
  from: State;
  to: State;
}

export type TransitionResult<State extends string> =
  | { ok: true; state: State }
  | { ok: false; state: State; error: string };

export function transitionState<State extends string>(
  current: State,
  target: State,
  allowed: readonly Transition<State>[],
): TransitionResult<State> {
  if (current === target) return { ok: true, state: current };
  const permitted = allowed.some((transition) => transition.from === current && transition.to === target);
  if (!permitted) return { ok: false, state: current, error: \`Cannot move from \${current} to \${target}.\` };
  return { ok: true, state: target };
}
`,
    },
  ];
}

function transactionFiles(): MaterializedFile[] {
  return [
    {
      path: "src/system/transaction.ts",
      content: `export type TransactionResult<State, Value> =
  | { ok: true; state: State; value: Value }
  | { ok: false; state: State; error: string };

export function transact<State, Value>(
  current: State,
  prepare: (snapshot: State) => { next: State; value: Value } | { error: string },
): TransactionResult<State, Value> {
  const prepared = prepare(structuredClone(current));
  if ("error" in prepared) return { ok: false, state: current, error: prepared.error };
  return { ok: true, state: prepared.next, value: prepared.value };
}

export interface TransactionEnvelope<State> {
  state: State;
  completedKeys: readonly string[];
}

export type IdempotentTransactionResult<State, Value> =
  | { ok: true; envelope: TransactionEnvelope<State>; value: Value }
  | { ok: false; envelope: TransactionEnvelope<State>; error: string };

export function transactOnce<State, Value>(
  current: TransactionEnvelope<State>,
  idempotencyKey: string,
  prepare: (snapshot: State) => { next: State; value: Value } | { error: string },
): IdempotentTransactionResult<State, Value> {
  const key = idempotencyKey.trim();
  if (!key) return { ok: false, envelope: current, error: "An idempotency key is required." };
  if (current.completedKeys.includes(key)) {
    return { ok: false, envelope: current, error: "This transaction was already completed." };
  }
  const result = transact(current.state, prepare);
  if (!result.ok) return { ok: false, envelope: current, error: result.error };
  return {
    ok: true,
    envelope: { state: result.state, completedKeys: [...current.completedKeys, key] },
    value: result.value,
  };
}
`,
    },
  ];
}

function paymentFiles(): MaterializedFile[] {
  return [
    {
      path: "src/system/payment.ts",
      content: `export type PaymentMode = "succeed" | "decline";
export type PaymentResult =
  | { ok: true; reference: string }
  | { ok: false; code: "declined" | "invalid"; message: string };

export interface PaymentInput {
  amountMinor: number;
  mode: PaymentMode;
  idempotencyKey: string;
}

export interface PaymentProvider {
  charge(input: PaymentInput): Promise<PaymentResult>;
}

export class DeterministicPaymentStub implements PaymentProvider {
  async charge(input: PaymentInput): Promise<PaymentResult> {
    const key = input.idempotencyKey.trim();
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !key) {
      return { ok: false, code: "invalid", message: "A positive amount and idempotency key are required." };
    }
    if (input.mode === "decline") {
      return { ok: false, code: "declined", message: "The simulated payment was declined." };
    }
    return { ok: true, reference: \`stub-\${key}\` };
  }
}
`,
    },
  ];
}

function accessibleShellFiles(): MaterializedFile[] {
  return [
    { path: "src/system/record-form.tsx", content: RECORD_FORM_SOURCE },
    {
      path: "src/system/ui.tsx",
      content: `import { useEffect, useId, type PropsWithChildren, type ReactNode } from "react";

export function AppShell({ title, subtitle, eyebrow, actions, navigation, children }: PropsWithChildren<{
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
  navigation?: ReactNode;
}>) {
  const mainId = useId();
  useEffect(() => { document.title = title; }, [title]);
  return (
    <div className="app-shell">
      <a className="skip-link" href={"#" + mainId}>Skip to content</a>
      <header className="app-header">
        <div className="app-identity">
          <span className="product-mark" aria-hidden="true">{title.trim().slice(0, 1).toUpperCase()}</span>
          <div className="app-heading">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h1>{title}</h1>
            {subtitle ? <p className="subtitle">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="header-actions">{actions}</div> : null}
      </header>
      {navigation ? <nav className="app-navigation" aria-label="Main navigation">{navigation}</nav> : null}
      <main id={mainId} tabIndex={-1}>{children}</main>
    </div>
  );
}

export function SectionHeader({ title, description, actions }: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return <div className="section-header"><div><h2>{title}</h2>{description ? <p className="section-description">{description}</p> : null}</div>{actions ? <div className="actions">{actions}</div> : null}</div>;
}

export function FieldError({ id, children }: PropsWithChildren<{ id: string }>) {
  if (!children) return null;
  return <p id={id} role="alert" className="field-error">{children}</p>;
}

export function EmptyState({ title, action, children }: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return <section className="empty-state" aria-live="polite"><h2>{title}</h2>{children ? <div className="empty-state-copy">{children}</div> : null}{action ? <div className="empty-state-action">{action}</div> : null}</section>;
}

export function StatusMessage({ tone = "info", children }: PropsWithChildren<{ tone?: "info" | "success" | "error" }>) {
  if (!children) return null;
  return <p className="status-message" data-tone={tone} role={tone === "error" ? "alert" : "status"}>{children}</p>;
}
`,
    },
  ];
}

function verificationFiles(): MaterializedFile[] {
  return [
    {
      path: "src/system/test-contract.ts",
      content: `export const PRODUCT_TEST_CONTRACT = {
  requiresObservableJourneyTests: true,
  allowsTodoTests: false,
  requiresVisibleValidationFeedback: true,
} as const;
`,
    },
    {
      path: "src/system/app-smoke.test.tsx",
      content: `import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../product/App";

describe("compiled application smoke contract", () => {
  it("renders the default App without React runtime errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation((...arguments_) => {
      const message = arguments_.map(String).join(" ");
      if (/Maximum update depth|Invalid hook call|uncaught error/i.test(message)) throw new Error(message);
    });
    try {
      render(<App />);
      expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
`,
    },
  ];
}

export const CAPABILITY_BLOCKS: CapabilityBlock[] = [
  {
    id: "app.foundation",
    version: "1.1.0",
    config_schema: objectSchema({ product_name: { type: "string", minLength: 1 }, product_summary: { type: "string", minLength: 1 } }, ["product_name"]),
    capabilities: ["react-vite-app", "typed-extension-boundary"],
    dependencies: [],
    conflicts: [],
    owned_files: [
      ".gitignore",
      ".npmrc",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "vite.config.ts",
      "vitest.config.ts",
      "index.html",
      "AGENTS.md",
      "src/system/product.ts",
      "src/test/setup.ts"
    ],
    exported_interfaces: ["PRODUCT_NAME", "PRODUCT_SUMMARY"],
    materialize: foundationFiles,
    checks: ["npm run build"],
  },
  {
    id: "data.local-repository",
    version: "1.1.0",
    config_schema: objectSchema(
      { storage_key: { type: "string", minLength: 1 }, schema_version: { type: "integer", minimum: 1 } },
      ["storage_key", "schema_version"],
    ),
    capabilities: ["local-persistence", "schema-versioning", "malformed-data-recovery", "repository-interface"],
    dependencies: ["app.foundation"],
    conflicts: ["data.external-repository"],
    owned_files: ["src/system/repository.ts"],
    exported_interfaces: ["Repository", "LocalStorageRepository"],
    materialize: repositoryFiles,
    checks: ["reload persistence", "malformed storage recovery"],
  },
  {
    id: "domain.collection",
    version: "1.0.0",
    config_schema: objectSchema({ entity_ids: { type: "array", items: { type: "string" } } }, ["entity_ids"]),
    capabilities: ["record-create", "record-list", "record-update", "record-delete", "filtering", "derived-metrics"],
    dependencies: ["app.foundation"],
    conflicts: [],
    owned_files: ["src/system/collection.ts"],
    exported_interfaces: ["Identified", "upsertRecord", "removeRecord", "countWhere"],
    materialize: collectionFiles,
    checks: ["CRUD journey tests", "filter tests", "metric tests"],
  },
  {
    id: "domain.workflow",
    version: "1.0.0",
    config_schema: objectSchema({ workflow_ids: { type: "array", items: { type: "string" } } }, ["workflow_ids"]),
    capabilities: ["state-machine", "transition-guards", "invalid-transition-feedback"],
    dependencies: ["app.foundation"],
    conflicts: [],
    owned_files: ["src/system/workflow.ts"],
    exported_interfaces: ["Transition", "TransitionResult", "transitionState"],
    materialize: workflowFiles,
    checks: ["allowed transition tests", "invalid transition tests"],
  },
  {
    id: "domain.transaction",
    version: "1.0.0",
    config_schema: objectSchema({ mode: { const: "atomic-local" } }, ["mode"]),
    capabilities: ["atomic-effects", "failure-rollback", "idempotent-submit"],
    dependencies: ["app.foundation"],
    conflicts: [],
    owned_files: ["src/system/transaction.ts"],
    exported_interfaces: [
      "TransactionResult",
      "TransactionEnvelope",
      "IdempotentTransactionResult",
      "transact",
      "transactOnce",
    ],
    materialize: transactionFiles,
    checks: ["success commits once", "failure preserves state", "duplicate idempotency key is rejected"],
  },
  {
    id: "integration.payment-stub",
    version: "1.0.0",
    config_schema: objectSchema({ modes: { type: "array", items: { enum: ["succeed", "decline"] } } }, ["modes"]),
    capabilities: ["payment-provider-interface", "deterministic-success", "deterministic-decline", "no-network-payment"],
    dependencies: ["domain.transaction"],
    conflicts: ["integration.real-payment"],
    owned_files: ["src/system/payment.ts"],
    exported_interfaces: ["PaymentProvider", "PaymentInput", "PaymentMode", "PaymentResult", "DeterministicPaymentStub"],
    materialize: paymentFiles,
    checks: ["stub success test", "stub decline test", "no payment network test"],
  },
  {
    id: "ui.accessible-shell",
    version: "1.2.0",
    config_schema: objectSchema({}, []),
    capabilities: ["responsive-shell", "accessible-forms", "empty-states", "visible-errors", "status-feedback"],
    dependencies: ["app.foundation"],
    conflicts: [],
    owned_files: ["src/system/ui.tsx", "src/system/record-form.tsx"],
    exported_interfaces: ["AppShell", "SectionHeader", "FieldError", "EmptyState", "StatusMessage", "RecordForm", "RecordField", "FormResult", "RecordFormProps"],
    materialize: accessibleShellFiles,
    checks: ["accessible names", "keyboard operation", "responsive layout"],
  },
  {
    id: "ui.collection-controller",
    version: "1.0.0",
    config_schema: objectSchema({}, []),
    capabilities: ["optional-local-collection-controller", "atomic-save-feedback", "domain-action-forms"],
    dependencies: ["data.local-repository", "domain.collection", "ui.accessible-shell"],
    conflicts: [],
    owned_files: ["src/system/collection-controller.tsx"],
    exported_interfaces: ["CollectionValues", "CollectionErrors", "CollectionItem", "CollectionActionResult", "CollectionAction", "CollectionDefinition", "CollectionEditorState", "CollectionController", "prepareCollectionAction", "useCollection", "CollectionEditor"],
    materialize: () => [{ path: "src/system/collection-controller.tsx", content: COLLECTION_CONTROLLER_SOURCE }],
    checks: ["collection save failure preserves state and draft", "action guards and edit preservation", "reload and recovery feedback"],
  },
  {
    id: "verification.product",
    version: "1.0.0",
    config_schema: objectSchema({ journey_ids: { type: "array", items: { type: "string" } } }, ["journey_ids"]),
    capabilities: ["journey-tests", "typecheck", "production-build"],
    dependencies: ["app.foundation"],
    conflicts: [],
    owned_files: ["src/system/test-contract.ts", "src/system/app-smoke.test.tsx"],
    exported_interfaces: ["PRODUCT_TEST_CONTRACT"],
    materialize: verificationFiles,
    checks: ["npm test", "npm run build"],
  },
];

export function capabilityBlock(blockId: string): CapabilityBlock | undefined {
  if (blockId === EXECUTABLE_COLLECTION_BLOCK.id) return EXECUTABLE_COLLECTION_BLOCK;
  return CAPABILITY_BLOCKS.find((block) => block.id === blockId);
}
