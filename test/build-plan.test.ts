import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBuilderPiArguments } from "../src/builder.js";
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

  it("configures the builder without shell or package-install access", () => {
    const spec = validProductSpec();
    const plan = compileProductSpec(spec);
    const args = buildBuilderPiArguments(spec, plan, "Builder prompt", "App context", "/tmp/run");
    expect(args[args.indexOf("--tools") + 1]).toBe("read,write,edit");
    expect(args.join(" ")).not.toContain("read,bash");
    expect(args.join(" ")).toContain("owned-paths.ts");
    expect(args.at(-1)).toContain("Validated ProductSpec");
  });
});
