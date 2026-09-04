import { capabilityBlock } from "./blocks.js";
import { contentHash } from "./hash.js";
import type { BuildPlan, PlannedBlock, RequirementImplementation } from "./types.js";
import type { ProductSpec, Requirement } from "../product-spec/types.js";

const BLOCK_ORDER = [
  "app.foundation",
  "data.local-repository",
  "domain.collection",
  "domain.workflow",
  "domain.transaction",
  "integration.payment-stub",
  "ui.accessible-shell",
  "verification.product",
] as const;

const AGENT_FILES = [
  "src/product/App.tsx",
  "src/product/domain.ts",
  "src/product/product.test.tsx",
  "src/product/styles.css",
];

const LINKER_FILES = [
  ".agent-cofounder-output",
  "build_plan.json",
  "file_ownership.json",
  "idea_spec.json",
  "report.partial.json",
  "result.json",
  "trace.jsonl",
  "src/App.tsx",
  "src/main.tsx",
  "src/styles.css",
];

function selectedBlockIds(spec: ProductSpec): Set<string> {
  const selected = new Set<string>(["app.foundation", "ui.accessible-shell", "verification.product"]);
  if (spec.persistence.mode === "LOCAL") selected.add("data.local-repository");
  if (spec.entities.length > 0 || spec.selected_patterns.includes("crud.collection@1.0.0")) {
    selected.add("domain.collection");
  }
  if (spec.workflows.length > 0 || spec.selected_patterns.includes("workflow.state-machine@1.0.0")) {
    selected.add("domain.workflow");
  }
  if (
    spec.selected_patterns.includes("transaction.atomic@1.0.0") ||
    spec.selected_patterns.includes("domain.commerce@1.0.0")
  ) {
    selected.add("domain.transaction");
  }
  if (
    spec.selected_patterns.includes("checkout.stubbed@1.0.0") ||
    spec.integrations.some((integration) => integration.mode === "STUB" && /payment/iu.test(integration.kind))
  ) {
    selected.add("integration.payment-stub");
  }

  const addDependencies = (blockId: string, visiting = new Set<string>()): void => {
    if (visiting.has(blockId)) throw new Error(`Capability dependency cycle at ${blockId}`);
    const block = capabilityBlock(blockId);
    if (!block) throw new Error(`Unknown capability block: ${blockId}`);
    visiting.add(blockId);
    for (const dependency of block.dependencies) {
      selected.add(dependency);
      addDependencies(dependency, visiting);
    }
    visiting.delete(blockId);
  };
  for (const blockId of [...selected]) addDependencies(blockId);
  return selected;
}

function blockConfig(blockId: string, spec: ProductSpec): Record<string, unknown> {
  switch (blockId) {
    case "app.foundation":
      return { product_name: spec.product.experience?.name ?? spec.product.summary, product_summary: spec.product.summary };
    case "data.local-repository":
      return { storage_key: `agent-cofounder:${spec.source_idea_hash.slice(7, 23)}`, schema_version: 1 };
    case "domain.collection":
      return { entity_ids: spec.entities.map((entity) => entity.id).sort() };
    case "domain.workflow":
      return { workflow_ids: spec.workflows.map((workflow) => workflow.id).sort() };
    case "domain.transaction":
      return { mode: "atomic-local" };
    case "integration.payment-stub":
      return { modes: ["succeed", "decline"] };
    case "ui.accessible-shell":
      return {};
    case "verification.product":
      return { journey_ids: spec.acceptance_journeys.map((journey) => journey.id).sort() };
    default:
      throw new Error(`No configuration resolver for block ${blockId}`);
  }
}

function requirementBlocks(requirement: Requirement, selected: Set<string>): string[] {
  const text = `${requirement.title} ${requirement.description}`.toLowerCase();
  const matches: string[] = [];
  const add = (blockId: string): void => {
    if (selected.has(blockId) && !matches.includes(blockId)) matches.push(blockId);
  };

  if (requirement.kind === "PERSISTENCE") add("data.local-repository");
  if (requirement.kind === "SCOPE") add("app.foundation");
  if (/add|create|list|edit|update|delete|remove|filter|count|total|catalog|collection|record/u.test(text)) {
    add("domain.collection");
  }
  if (/workflow|state|status|stage|transition|lend|borrow|return|shipped|inbox|planned/u.test(text)) {
    add("domain.workflow");
  }
  if (/checkout|order|stock|atomic|unchanged|exactly once|transaction/u.test(text)) add("domain.transaction");
  if (/payment|declin/u.test(text)) add("integration.payment-stub");
  if (/invalid|validation|feedback|accessible|responsive|empty/u.test(text)) add("ui.accessible-shell");
  return matches.sort((left, right) => BLOCK_ORDER.indexOf(left as never) - BLOCK_ORDER.indexOf(right as never));
}

function plannedBlocks(spec: ProductSpec, selected: Set<string>): PlannedBlock[] {
  return BLOCK_ORDER.filter((blockId) => selected.has(blockId)).map((blockId, order) => {
    const block = capabilityBlock(blockId);
    if (!block) throw new Error(`Unknown selected block ${blockId}`);
    return { id: block.id, version: block.version, order, config: blockConfig(blockId, spec) };
  });
}

export function compileProductSpec(spec: ProductSpec): BuildPlan {
  const selected = selectedBlockIds(spec);
  const blocks = plannedBlocks(spec, selected);
  const implementedRequirements = spec.requirements.filter((requirement) => requirement.disposition === "IMPLEMENT");
  const customSlotId = "custom_product";
  const requirementMapping: RequirementImplementation[] = implementedRequirements.map((requirement) => ({
    requirement_id: requirement.id,
    block_ids: requirementBlocks(requirement, selected),
    custom_slot_ids: [customSlotId],
  }));

  const fileOwnership = [
    ...blocks.flatMap((planned) => {
      const block = capabilityBlock(planned.id);
      if (!block) throw new Error(`Unknown selected block ${planned.id}`);
      return block.owned_files.map((file) => ({ path: file, owner: "BLOCK" as const, owner_id: planned.id }));
    }),
    ...AGENT_FILES.map((file) => ({ path: file, owner: "AGENT" as const, owner_id: customSlotId })),
    ...LINKER_FILES.map((file) => ({ path: file, owner: "LINKER" as const, owner_id: "deterministic_linker" })),
  ].sort((left, right) => left.path.localeCompare(right.path));

  return {
    version: "0.1",
    product_spec_hash: contentHash(spec),
    blocks,
    custom_slots: [
      {
        id: customSlotId,
        purpose: "Implement product-specific domain composition, interface language, visual design, and journey tests.",
        requirement_ids: implementedRequirements.map((requirement) => requirement.id),
        required_interfaces: blocks.flatMap((planned) => capabilityBlock(planned.id)?.exported_interfaces ?? []),
        permitted_paths: [...AGENT_FILES],
      },
    ],
    file_ownership: fileOwnership,
    dependencies: {
      runtime: ["@testing-library/react", "react", "react-dom"],
      development: ["@vitejs/plugin-react", "jsdom", "typescript", "vite", "vitest"],
      install_allowed: false,
    },
    routes: [{ path: "/", component: "src/product/App.tsx" }],
    exports: [{ from: "src/product/App.tsx", names: ["default"] }],
    requirement_mapping: requirementMapping,
    verification_obligations: spec.acceptance_journeys.map((journey) => ({
      id: `verify_${journey.id}`,
      journey_id: journey.id,
      requirement_ids: [...journey.requirement_ids],
      checks: [...journey.expected_outcomes],
    })),
  };
}
