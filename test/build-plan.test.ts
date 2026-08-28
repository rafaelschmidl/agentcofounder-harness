import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildBuilderPiArguments, builderThinkingFromEnvironment, loadBuilderPrompts } from "../src/builder.js";
import { compileProductSpec } from "../src/build-plan/compile.js";
import { contentHash } from "../src/build-plan/hash.js";
import { linkBuildPlan, materializeBuildPlan } from "../src/build-plan/materialize.js";
import { validateBuildPlan } from "../src/build-plan/validate.js";
import type { ProductSpec } from "../src/product-spec/types.js";
import { mayAgentWrite } from "../solution/extensions/owned-paths.js";
import { validProductSpec } from "./fixtures/product-spec.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function commerceSpec(): ProductSpec {
  const spec = validProductSpec();
  spec.selected_patterns.push(
    "domain.commerce@1.0.0",
    "transaction.atomic@1.0.0",
    "checkout.stubbed@1.0.0",
    "metrics.derived@1.0.0",
  );
  spec.integrations.push({
    id: "integration_payment",
    kind: "payment provider",
    mode: "STUB",
    description: "A deterministic local payment stub.",
    requirement_ids: ["req_notes"],
  });
  return spec;
}

function workflowSpec(): ProductSpec {
  const spec = validProductSpec();
  spec.selected_patterns.push("workflow.state-machine@1.0.0", "domain.saas-operations@1.0.0");
  spec.workflows.push({
    id: "workflow_note",
    name: "Note workflow",
    entity_id: "entity_note",
    initial_state: "inbox",
    states: ["inbox", "done"],
    transitions: [
      { id: "transition_finish", from: "inbox", to: "done", trigger: "Finish", guards: [], effects: [] },
    ],
    invariants: ["Done is terminal."],
  });
  return spec;
}

describe("deterministic BuildPlan compiler", () => {
  it("resolves a local collection into ordered compatible blocks", () => {
    const spec = validProductSpec();
    const plan = compileProductSpec(spec);
    expect(plan.blocks.map((block) => block.id)).toEqual([
      "app.foundation",
      "data.local-repository",
      "domain.collection",
      "ui.accessible-shell",
      "verification.product",
    ]);
    expect(validateBuildPlan(plan, spec)).toEqual({ valid: true, errors: [], plan });
    expect(plan.requirement_mapping.every((mapping) => mapping.custom_slot_ids.includes("custom_product"))).toBe(true);
  });

  it("selects transaction and payment capabilities for commerce", () => {
    const spec = commerceSpec();
    const plan = compileProductSpec(spec);
    expect(plan.blocks.map((block) => block.id)).toEqual([
      "app.foundation",
      "data.local-repository",
      "domain.collection",
      "domain.transaction",
      "integration.payment-stub",
      "ui.accessible-shell",
      "verification.product",
    ]);
    expect(validateBuildPlan(plan, spec).valid).toBe(true);
  });

  it("selects an explicit state-machine block for workflow products", () => {
    const spec = workflowSpec();
    const plan = compileProductSpec(spec);
    expect(plan.blocks.map((block) => block.id)).toContain("domain.workflow");
    expect(validateBuildPlan(plan, spec).valid).toBe(true);
  });

  it("produces stable content and ownership hashes for reviewed specs", () => {
    const hashes = [validProductSpec(), commerceSpec(), workflowSpec()].map((spec) =>
      contentHash(compileProductSpec(spec)),
    );
    const repeated = [validProductSpec(), commerceSpec(), workflowSpec()].map((spec) =>
      contentHash(compileProductSpec(spec)),
    );
    expect(repeated).toEqual(hashes);
    expect(hashes.every((hash) => /^sha256:[a-f0-9]{64}$/u.test(hash))).toBe(true);
  });

  it("rejects incompatible configuration and ambiguous ownership", () => {
    const spec = validProductSpec();
    const plan = compileProductSpec(spec);
    const persistence = plan.blocks.find((block) => block.id === "data.local-repository");
    if (!persistence) throw new Error("missing persistence block");
    persistence.config = { storage_key: "notes", schema_version: 0 };
    plan.file_ownership.push({ ...plan.file_ownership[0]! });
    const result = validateBuildPlan(plan, spec);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("must be >= 1");
    expect(result.errors.join("\n")).toContain("file ownership is ambiguous");
  });

  it("materializes deterministic files, preserves agent work, and relinks runner-owned files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "build-plan-materialize-"));
    temporaryDirectories.push(directory);
    const spec = validProductSpec();
    const plan = compileProductSpec(spec);

    await materializeBuildPlan(plan, spec, directory);
    await linkBuildPlan(plan, spec, directory);
    const agentFile = path.join(directory, "src/product/domain.ts");
    await writeFile(agentFile, "export const preserved = true;\n", "utf8");
    await writeFile(path.join(directory, "src/system/collection.ts"), "tampered\n", "utf8");
    await materializeBuildPlan(plan, spec, directory);
    await linkBuildPlan(plan, spec, directory);

    expect(await readFile(agentFile, "utf8")).toBe("export const preserved = true;\n");
    expect(await readFile(path.join(directory, "src/system/collection.ts"), "utf8")).toContain("upsertRecord");
    expect(JSON.parse(await readFile(path.join(directory, "build_plan.json"), "utf8"))).toEqual(plan);
    expect(await readFile(path.join(directory, "src/App.tsx"), "utf8")).toContain("./product/App");
  });

  it("allows the builder to edit only exact AGENT-owned files", () => {
    const plan = compileProductSpec(validProductSpec());
    expect(mayAgentWrite("/tmp/app", plan.file_ownership, "src/product/App.tsx")).toBe(true);
    expect(mayAgentWrite("/tmp/app", plan.file_ownership, "src/system/repository.ts")).toBe(false);
    expect(mayAgentWrite("/tmp/app", plan.file_ownership, "../outside.ts")).toBe(false);
    expect(mayAgentWrite("/tmp/app", plan.file_ownership, "report.partial.json")).toBe(false);
  });

  it("configures the builder for owned writes without read, shell, or package-install access", () => {
    const previousThinking = process.env.CHALLENGE_BUILDER_THINKING;
    delete process.env.CHALLENGE_BUILDER_THINKING;
    const spec = validProductSpec();
    const plan = compileProductSpec(spec);
    try {
      const args = buildBuilderPiArguments(spec, plan, "Builder prompt", "App context", "/tmp/run");
      expect(args[args.indexOf("--tools") + 1]).toBe("write");
      expect(args[args.indexOf("--tools") + 1]).not.toContain("bash");
      expect(args[args.indexOf("--thinking") + 1]).toBe("off");
      expect(args.join(" ")).toContain("owned-paths.ts");
      expect(args.at(-1)).toContain("Validated ProductSpec");
      process.env.CHALLENGE_BUILDER_THINKING = "low";
      expect(builderThinkingFromEnvironment()).toBe("low");
    } finally {
      if (previousThinking === undefined) delete process.env.CHALLENGE_BUILDER_THINKING;
      else process.env.CHALLENGE_BUILDER_THINKING = previousThinking;
    }
  });

  it("supplies materialized system interfaces without spending builder read turns", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "builder-interface-context-"));
    temporaryDirectories.push(directory);
    const spec = commerceSpec();
    const plan = compileProductSpec(spec);
    await writeFile(path.join(directory, "AGENTS.md"), "# Generated app contract\n", "utf8");
    await materializeBuildPlan(plan, spec, directory);

    const prompts = await loadBuilderPrompts(directory, plan);

    expect(prompts.appContext).toContain("## Materialized system interfaces");
    expect(prompts.appContext).toContain("src/system/repository.ts");
    expect(prompts.appContext).toContain("LocalStorageRepository");
    expect(prompts.appContext).toContain("src/system/payment.ts");
    expect(prompts.appContext).toContain("DeterministicPaymentStub");
  });

  it("materializes rollback-safe, idempotent commerce primitives", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "commerce-primitives-"));
    temporaryDirectories.push(directory);
    const spec = commerceSpec();
    const plan = compileProductSpec(spec);
    await materializeBuildPlan(plan, spec, directory);

    const transaction = await import(pathToFileURL(path.join(directory, "src/system/transaction.ts")).href);
    const payment = await import(pathToFileURL(path.join(directory, "src/system/payment.ts")).href);
    const initial = { stock: 2, cart: ["book"] };
    const failed = transaction.transact(initial, (snapshot: typeof initial) => {
      snapshot.stock = 0;
      snapshot.cart.push("tampered");
      return { error: "declined" };
    });

    expect(failed).toEqual({ ok: false, state: initial, error: "declined" });
    expect(initial).toEqual({ stock: 2, cart: ["book"] });

    const envelope = { state: initial, completedKeys: [] as string[] };
    const completed = transaction.transactOnce(envelope, "order-1", (snapshot: typeof initial) => ({
      next: { ...snapshot, stock: snapshot.stock - 1, cart: [] },
      value: "paid",
    }));
    expect(completed.ok).toBe(true);
    expect(completed.envelope).toEqual({ state: { stock: 1, cart: [] }, completedKeys: ["order-1"] });
    const duplicate = transaction.transactOnce(completed.envelope, "order-1", () => {
      throw new Error("duplicate transaction must not run");
    });
    expect(duplicate).toEqual({
      ok: false,
      envelope: completed.envelope,
      error: "This transaction was already completed.",
    });

    const provider = new payment.DeterministicPaymentStub();
    await expect(provider.charge({ amountMinor: 1200, mode: "succeed", idempotencyKey: "order-1" })).resolves.toEqual({
      ok: true,
      reference: "stub-order-1",
    });
    await expect(provider.charge({ amountMinor: 1200, mode: "decline", idempotencyKey: "order-2" })).resolves.toEqual({
      ok: false,
      code: "declined",
      message: "The simulated payment was declined.",
    });
    await expect(provider.charge({ amountMinor: 0, mode: "succeed", idempotencyKey: "" })).resolves.toMatchObject({
      ok: false,
      code: "invalid",
    });
  });
});
