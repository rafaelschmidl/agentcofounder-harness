import { readFileSync } from "node:fs";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { hasPattern } from "../patterns/catalog.js";
import { COLLECTION_EXECUTION_SCHEMA } from "../executable-collection/schema.js";
import { collectionExecutionErrors } from "../executable-collection/validate.js";
import { hashIdea, segmentIdea } from "./fragments.js";
import type { ProductSpec, SourceFragment, SourceReference } from "./types.js";

const schema = JSON.parse(
  readFileSync(new URL("./product-spec.schema.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const ajv = new Ajv({ allErrors: true, strict: true });
// Optional experiment extends canonical validation; the default schema and provenance rules remain strict.
(schema.properties as Record<string, unknown>).collection_execution = COLLECTION_EXECUTION_SCHEMA;
const validateSchema: ValidateFunction = ajv.compile(schema);

export interface ProductSpecValidation {
  valid: boolean;
  errors: string[];
  spec?: ProductSpec;
}

function schemaError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `schema ${location}: ${error.message ?? error.keyword}`;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

function assertUnique(errors: string[], label: string, ids: string[]): void {
  for (const id of duplicates(ids)) errors.push(`${label} contains duplicate ID ${id}`);
}

function validateSourceReference(
  reference: SourceReference,
  idea: string,
  fragments: Map<string, SourceFragment>,
  location: string,
  errors: string[],
): void {
  const fragment = fragments.get(reference.fragment_id);
  if (!fragment) {
    errors.push(`${location} references unknown fragment ${reference.fragment_id}`);
    return;
  }
  if (reference.start < fragment.start || reference.end > fragment.end || reference.end <= reference.start) {
    errors.push(`${location} range is outside fragment ${reference.fragment_id}`);
    return;
  }
  if (idea.slice(reference.start, reference.end) !== reference.quote) {
    errors.push(`${location} quote does not match the exact source range`);
  }
}

function sameFragments(actual: SourceFragment[], expected: SourceFragment[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((fragment, index) => {
      const reference = expected[index];
      return (
        reference !== undefined &&
        fragment.id === reference.id &&
        fragment.start === reference.start &&
        fragment.end === reference.end &&
        fragment.text === reference.text
      );
    })
  );
}

function semanticErrors(spec: ProductSpec, idea: string, expectedFragments: SourceFragment[]): string[] {
  const errors: string[] = [];
  if (spec.source_idea_hash !== hashIdea(idea)) errors.push("source_idea_hash does not match the raw idea");
  if (!sameFragments(spec.source_fragments, expectedFragments)) {
    errors.push("source_fragments must exactly match the runner-provided fragments in order");
  }

  const fragments = new Map(expectedFragments.map((fragment) => [fragment.id, fragment]));
  const requirementIds = new Set(spec.requirements.map((requirement) => requirement.id));
  const journeyIds = new Set(spec.acceptance_journeys.map((journey) => journey.id));
  const actorIds = new Set(spec.product.actors.map((actor) => actor.id));
  const entityIds = new Set(spec.entities.map((entity) => entity.id));

  assertUnique(errors, "requirements", spec.requirements.map((item) => item.id));
  assertUnique(errors, "actors", spec.product.actors.map((item) => item.id));
  assertUnique(errors, "entities", spec.entities.map((item) => item.id));
  assertUnique(errors, "workflows", spec.workflows.map((item) => item.id));
  assertUnique(errors, "integrations", spec.integrations.map((item) => item.id));
  assertUnique(errors, "views", spec.views.map((item) => item.id));
  assertUnique(errors, "acceptance_journeys", spec.acceptance_journeys.map((item) => item.id));

  const dispositionsByFragment = new Map<string, number>();
  const dispositionRequirements = new Map<string, Set<string>>();
  for (const disposition of spec.fragment_disposition) {
    dispositionsByFragment.set(
      disposition.fragment_id,
      (dispositionsByFragment.get(disposition.fragment_id) ?? 0) + 1,
    );
    dispositionRequirements.set(disposition.fragment_id, new Set(disposition.requirement_ids));
    if (!fragments.has(disposition.fragment_id)) {
      errors.push(`fragment_disposition references unknown fragment ${disposition.fragment_id}`);
    }
    for (const requirementId of disposition.requirement_ids) {
      if (!requirementIds.has(requirementId)) {
        errors.push(`fragment_disposition references unknown requirement ${requirementId}`);
      }
    }
    if (disposition.classification === "USED" && disposition.requirement_ids.length === 0) {
      errors.push(`USED fragment ${disposition.fragment_id} must map to at least one requirement`);
    }
  }
  for (const fragment of expectedFragments) {
    const count = dispositionsByFragment.get(fragment.id) ?? 0;
    if (count !== 1) errors.push(`fragment ${fragment.id} must have exactly one disposition; found ${count}`);
  }

  for (const requirement of spec.requirements) {
    for (const [index, reference] of requirement.source_refs.entries()) {
      validateSourceReference(reference, idea, fragments, `requirement ${requirement.id} source_refs[${index}]`, errors);
    }
    if (requirement.provenance === "EXPLICIT" && requirement.source_refs.length === 0) {
      errors.push(`EXPLICIT requirement ${requirement.id} must have source_refs`);
    }
    if (requirement.provenance === "EXCLUDED" && requirement.source_refs.length === 0) {
      errors.push(`EXCLUDED requirement ${requirement.id} must have source_refs`);
    }
    if (requirement.provenance === "DEFAULT" && requirement.source_refs.length > 0) {
      errors.push(`DEFAULT requirement ${requirement.id} must not claim source_refs`);
    }
    if (requirement.provenance === "PROPOSED" && requirement.disposition !== "PROPOSE") {
      errors.push(`PROPOSED requirement ${requirement.id} must use PROPOSE disposition`);
    }
    if (requirement.provenance === "EXCLUDED" && requirement.disposition !== "EXCLUDE") {
      errors.push(`EXCLUDED requirement ${requirement.id} must use EXCLUDE disposition`);
    }
    if (
      ["EXPLICIT", "IMPLIED", "DEFAULT"].includes(requirement.provenance) &&
      requirement.disposition !== "IMPLEMENT"
    ) {
      errors.push(`${requirement.provenance} requirement ${requirement.id} must use IMPLEMENT disposition`);
    }
    if (requirement.disposition === "IMPLEMENT" && requirement.journey_ids.length === 0) {
      errors.push(`implemented requirement ${requirement.id} must map to an acceptance journey`);
    }
    if (requirement.disposition !== "IMPLEMENT" && requirement.journey_ids.length > 0) {
      errors.push(`non-implemented requirement ${requirement.id} must not map to acceptance journeys`);
    }
    for (const journeyId of requirement.journey_ids) {
      if (!journeyIds.has(journeyId)) errors.push(`requirement ${requirement.id} references unknown journey ${journeyId}`);
    }
    for (const reference of requirement.source_refs) {
      if (!(dispositionRequirements.get(reference.fragment_id)?.has(requirement.id) ?? false)) {
        errors.push(
          `requirement ${requirement.id} source fragment ${reference.fragment_id} is missing from fragment_disposition mapping`,
        );
      }
    }
  }

  for (const journey of spec.acceptance_journeys) {
    if (!actorIds.has(journey.actor_id)) errors.push(`journey ${journey.id} references unknown actor ${journey.actor_id}`);
    for (const requirementId of journey.requirement_ids) {
      const requirement = spec.requirements.find((candidate) => candidate.id === requirementId);
      if (!requirement) {
        errors.push(`journey ${journey.id} references unknown requirement ${requirementId}`);
      } else if (requirement.disposition !== "IMPLEMENT") {
        errors.push(`journey ${journey.id} references non-implemented requirement ${requirementId}`);
      } else if (!requirement.journey_ids.includes(journey.id)) {
        errors.push(`journey ${journey.id} and requirement ${requirementId} mappings disagree`);
      }
    }
  }

  for (const workflow of spec.workflows) {
    if (!entityIds.has(workflow.entity_id)) {
      errors.push(`workflow ${workflow.id} references unknown entity ${workflow.entity_id}`);
    }
    if (!workflow.states.includes(workflow.initial_state)) {
      errors.push(`workflow ${workflow.id} initial_state is not declared in states`);
    }
    assertUnique(errors, `workflow ${workflow.id} transitions`, workflow.transitions.map((item) => item.id));
    for (const transition of workflow.transitions) {
      if (!workflow.states.includes(transition.from) || !workflow.states.includes(transition.to)) {
        errors.push(`workflow ${workflow.id} transition ${transition.id} references an unknown state`);
      }
    }
  }

  for (const integration of spec.integrations) {
    for (const requirementId of integration.requirement_ids) {
      if (!requirementIds.has(requirementId)) {
        errors.push(`integration ${integration.id} references unknown requirement ${requirementId}`);
      }
    }
  }
  for (const view of spec.views) {
    for (const requirementId of view.requirement_ids) {
      if (!requirementIds.has(requirementId)) {
        errors.push(`view ${view.id} references unknown requirement ${requirementId}`);
      }
    }
  }
  for (const [index, conflict] of spec.conflicts.entries()) {
    for (const [referenceIndex, reference] of conflict.source_refs.entries()) {
      validateSourceReference(reference, idea, fragments, `conflicts[${index}].source_refs[${referenceIndex}]`, errors);
    }
  }
  for (const patternId of spec.selected_patterns) {
    if (!hasPattern(patternId)) errors.push(`selected_patterns references unknown pattern ${patternId}`);
  }

  return [...new Set(errors)];
}

export function validateProductSpec(
  candidate: unknown,
  idea: string,
  expectedFragments = segmentIdea(idea),
): ProductSpecValidation {
  if (!validateSchema(candidate)) {
    return {
      valid: false,
      errors: (validateSchema.errors ?? []).map(schemaError),
    };
  }

  const spec = candidate as ProductSpec;
  const errors = [...semanticErrors(spec, idea, expectedFragments), ...collectionExecutionErrors(spec)];
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], spec };
}
