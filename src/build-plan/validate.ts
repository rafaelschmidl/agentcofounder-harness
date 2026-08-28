import { readFileSync } from "node:fs";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { capabilityBlock } from "./blocks.js";
import { contentHash } from "./hash.js";
import type { BuildPlan } from "./types.js";
import type { ProductSpec } from "../product-spec/types.js";

const schema = JSON.parse(
  readFileSync(new URL("./build-plan.schema.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const ajv = new Ajv({ allErrors: true, strict: true });
const validateSchema: ValidateFunction = ajv.compile(schema);

export interface BuildPlanValidation {
  valid: boolean;
  errors: string[];
  plan?: BuildPlan;
}

function schemaError(error: ErrorObject): string {
  return `schema ${error.instancePath || "/"}: ${error.message ?? error.keyword}`;
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function semanticErrors(plan: BuildPlan, spec: ProductSpec): string[] {
  const errors: string[] = [];
  if (plan.product_spec_hash !== contentHash(spec)) errors.push("product_spec_hash does not match ProductSpec content");

  const blockIds = plan.blocks.map((block) => block.id);
  const blockIdSet = new Set(blockIds);
  const slotIds = new Set(plan.custom_slots.map((slot) => slot.id));
  const ownershipByPath = new Map(plan.file_ownership.map((entry) => [entry.path, entry]));
  const implementedRequirements = spec.requirements
    .filter((requirement) => requirement.disposition === "IMPLEMENT")
    .map((requirement) => requirement.id);

  for (const duplicate of duplicateValues(blockIds)) errors.push(`duplicate selected block ${duplicate}`);
  for (const duplicate of duplicateValues(plan.custom_slots.map((slot) => slot.id))) {
    errors.push(`duplicate custom slot ${duplicate}`);
  }
  for (const duplicate of duplicateValues(plan.file_ownership.map((entry) => entry.path))) {
    errors.push(`file ownership is ambiguous for ${duplicate}`);
  }
  for (const duplicate of duplicateValues(plan.requirement_mapping.map((mapping) => mapping.requirement_id))) {
    errors.push(`duplicate requirement mapping for ${duplicate}`);
  }

  if (plan.blocks.some((block, index) => block.order !== index)) {
    errors.push("block order must be contiguous and match the blocks array");
  }

  for (const planned of plan.blocks) {
    const block = capabilityBlock(planned.id);
    if (!block) {
      errors.push(`unknown block ${planned.id}`);
      continue;
    }
    if (block.version !== planned.version) errors.push(`unsupported version ${planned.version} for ${planned.id}`);
    const validateConfig = ajv.compile(block.config_schema);
    if (!validateConfig(planned.config)) {
      for (const error of validateConfig.errors ?? []) {
        errors.push(`block ${planned.id} config ${error.instancePath || "/"}: ${error.message ?? error.keyword}`);
      }
    }
    for (const dependency of block.dependencies) {
      const dependencyIndex = blockIds.indexOf(dependency);
      if (dependencyIndex < 0) errors.push(`block ${planned.id} is missing dependency ${dependency}`);
      else if (dependencyIndex >= planned.order) errors.push(`block ${planned.id} must follow dependency ${dependency}`);
    }
    for (const conflict of block.conflicts) {
      if (blockIdSet.has(conflict)) errors.push(`block ${planned.id} conflicts with ${conflict}`);
    }
    for (const ownedFile of block.owned_files) {
      const ownership = ownershipByPath.get(ownedFile);
      if (!ownership || ownership.owner !== "BLOCK" || ownership.owner_id !== block.id) {
        errors.push(`block-owned file ${ownedFile} is missing correct ownership for ${block.id}`);
      }
    }
  }

  for (const ownership of plan.file_ownership) {
    if (ownership.owner === "BLOCK" && !blockIdSet.has(ownership.owner_id)) {
      errors.push(`file ${ownership.path} is owned by unselected block ${ownership.owner_id}`);
    }
    if (ownership.owner === "AGENT" && !slotIds.has(ownership.owner_id)) {
      errors.push(`file ${ownership.path} is owned by unknown custom slot ${ownership.owner_id}`);
    }
    if (ownership.owner === "LINKER" && ownership.owner_id !== "deterministic_linker") {
      errors.push(`file ${ownership.path} has unknown linker owner ${ownership.owner_id}`);
    }
  }

  for (const slot of plan.custom_slots) {
    for (const permittedPath of slot.permitted_paths) {
      const ownership = ownershipByPath.get(permittedPath);
      if (!ownership || ownership.owner !== "AGENT" || ownership.owner_id !== slot.id) {
        errors.push(`custom slot ${slot.id} permitted path ${permittedPath} lacks matching AGENT ownership`);
      }
    }
    for (const requirementId of slot.requirement_ids) {
      if (!implementedRequirements.includes(requirementId)) {
        errors.push(`custom slot ${slot.id} references non-implemented requirement ${requirementId}`);
      }
    }
  }

  const mappingIds = plan.requirement_mapping.map((mapping) => mapping.requirement_id).sort();
  const expectedMappingIds = [...implementedRequirements].sort();
  if (JSON.stringify(mappingIds) !== JSON.stringify(expectedMappingIds)) {
    errors.push("requirement_mapping must cover every implemented requirement exactly once");
  }
  for (const mapping of plan.requirement_mapping) {
    if (mapping.block_ids.length === 0 && mapping.custom_slot_ids.length === 0) {
      errors.push(`requirement ${mapping.requirement_id} has no block or custom implementation`);
    }
    for (const blockId of mapping.block_ids) {
      if (!blockIdSet.has(blockId)) errors.push(`requirement ${mapping.requirement_id} references unselected block ${blockId}`);
    }
    for (const slotId of mapping.custom_slot_ids) {
      if (!slotIds.has(slotId)) errors.push(`requirement ${mapping.requirement_id} references unknown custom slot ${slotId}`);
    }
  }

  const journeyIds = spec.acceptance_journeys.map((journey) => journey.id).sort();
  const obligationJourneyIds = plan.verification_obligations.map((obligation) => obligation.journey_id).sort();
  if (JSON.stringify(journeyIds) !== JSON.stringify(obligationJourneyIds)) {
    errors.push("verification_obligations must cover every acceptance journey exactly once");
  }
  for (const obligation of plan.verification_obligations) {
    const journey = spec.acceptance_journeys.find((candidate) => candidate.id === obligation.journey_id);
    if (!journey) continue;
    if ([...obligation.requirement_ids].sort().join("|") !== [...journey.requirement_ids].sort().join("|")) {
      errors.push(`verification obligation ${obligation.id} requirement mapping disagrees with its journey`);
    }
  }

  for (const route of plan.routes) {
    const ownership = ownershipByPath.get(route.component);
    if (!ownership || ownership.owner !== "AGENT") {
      errors.push(`route component ${route.component} must be an AGENT-owned file`);
    }
  }

  return [...new Set(errors)];
}

export function validateBuildPlan(candidate: unknown, spec: ProductSpec): BuildPlanValidation {
  if (!validateSchema(candidate)) {
    return { valid: false, errors: (validateSchema.errors ?? []).map(schemaError) };
  }
  const plan = candidate as BuildPlan;
  const errors = semanticErrors(plan, spec);
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], plan };
}
