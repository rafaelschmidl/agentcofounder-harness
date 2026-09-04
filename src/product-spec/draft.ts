import { hashIdea } from "./fragments.js";
import { expandCollectionExecutionDraft } from "./execution-draft.js";
import type { ProductSpec, SourceFragment, SourceReference } from "./types.js";

type JsonObject = Record<string, unknown>;

export interface ProductSpecDraftExpansion {
  candidate?: unknown;
  errors: string[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dispositionForProvenance(provenance: unknown): unknown {
  switch (provenance) {
    case "EXPLICIT":
    case "IMPLIED":
    case "DEFAULT": return "IMPLEMENT";
    case "PROPOSED": return "PROPOSE";
    case "EXCLUDED": return "EXCLUDE";
    default: return undefined;
  }
}

function expandReferences(
  value: unknown,
  fragments: Map<string, SourceFragment>,
  location: string,
  errors: string[],
): SourceReference[] {
  if (!Array.isArray(value)) {
    errors.push(`${location} must be an array of source fragment IDs`);
    return [];
  }
  const references: SourceReference[] = [];
  for (const [index, fragmentId] of value.entries()) {
    if (typeof fragmentId !== "string") {
      errors.push(`${location}[${index}] must be a source fragment ID string`);
      continue;
    }
    const fragment = fragments.get(fragmentId);
    if (!fragment) {
      errors.push(`${location}[${index}] references unknown fragment ${fragmentId}`);
      continue;
    }
    references.push({
      fragment_id: fragment.id,
      start: fragment.start,
      end: fragment.end,
      quote: fragment.text,
    });
  }
  return references;
}

export function expandProductSpecDraft(
  draft: unknown,
  idea: string,
  sourceFragments: SourceFragment[],
): ProductSpecDraftExpansion {
  if (!isObject(draft)) return { errors: ["draft must be a JSON object"] };
  const errors: string[] = [];
  const fragments = new Map(sourceFragments.map((fragment) => [fragment.id, fragment]));

  const requirements = Array.isArray(draft.requirements)
    ? draft.requirements.map((requirement, index) => {
        if (!isObject(requirement)) {
          errors.push(`requirements[${index}] must be an object`);
          return requirement;
        }
        const provenance = requirement.disposition === "EXCLUDE" && requirement.provenance === "EXPLICIT"
          ? "EXCLUDED"
          : requirement.provenance;
        return {
          ...requirement,
          provenance,
          disposition: Object.hasOwn(requirement, "disposition")
            ? requirement.disposition
            : dispositionForProvenance(provenance),
          journey_ids: Object.hasOwn(requirement, "journey_ids") ? requirement.journey_ids : [],
          source_refs: expandReferences(
            requirement.source_refs,
            fragments,
            `requirements[${index}].source_refs`,
            errors,
          ),
        };
      })
    : draft.requirements;

  const conflicts = Array.isArray(draft.conflicts)
    ? draft.conflicts.map((conflict, index) => {
        if (!isObject(conflict)) {
          errors.push(`conflicts[${index}] must be an object`);
          return conflict;
        }
        return {
          ...conflict,
          source_refs: expandReferences(
            conflict.source_refs,
            fragments,
            `conflicts[${index}].source_refs`,
            errors,
          ),
        };
      })
    : draft.conflicts;

  let acceptanceJourneys = Array.isArray(draft.acceptance_journeys)
    ? draft.acceptance_journeys.map((journey) => isObject(journey) ? { ...journey } : journey)
    : draft.acceptance_journeys;
  if (Array.isArray(requirements) && Array.isArray(acceptanceJourneys)) {
    const requirementById = new Map(requirements
      .filter((requirement): requirement is JsonObject => isObject(requirement) && typeof requirement.id === "string")
      .map((requirement) => [requirement.id as string, requirement]));
    const journeyById = new Map(acceptanceJourneys
      .filter((journey): journey is JsonObject => isObject(journey) && typeof journey.id === "string")
      .map((journey) => [journey.id as string, journey]));
    const addUnique = (value: unknown, addition: string): unknown => {
      // Preserve explicitly invalid values for canonical validation instead of repairing them away.
      if (!Array.isArray(value)) return value;
      return value.includes(addition) ? value : [...value, addition];
    };
    for (const requirement of requirementById.values()) {
      const requirementId = requirement.id as string;
      const journeyIds = Array.isArray(requirement.journey_ids) ? requirement.journey_ids : [];
      for (const journeyId of journeyIds) {
        if (typeof journeyId !== "string") continue;
        const journey = journeyById.get(journeyId);
        if (journey) journey.requirement_ids = addUnique(journey.requirement_ids, requirementId);
      }
    }
    for (const journey of journeyById.values()) {
      const journeyId = journey.id as string;
      const requirementIds = Array.isArray(journey.requirement_ids) ? journey.requirement_ids : [];
      for (const requirementId of requirementIds) {
        if (typeof requirementId !== "string") continue;
        const requirement = requirementById.get(requirementId);
        if (requirement) requirement.journey_ids = addUnique(requirement.journey_ids, journeyId);
      }
    }
    acceptanceJourneys = [...acceptanceJourneys];
  }

  const requirementIdsByFragment = new Map<string, string[]>();
  if (Array.isArray(requirements)) {
    for (const requirement of requirements) {
      if (!isObject(requirement) || typeof requirement.id !== "string" || !Array.isArray(requirement.source_refs)) continue;
      for (const reference of requirement.source_refs) {
        if (!isObject(reference) || typeof reference.fragment_id !== "string") continue;
        const ids = requirementIdsByFragment.get(reference.fragment_id) ?? [];
        if (!ids.includes(requirement.id)) ids.push(requirement.id);
        requirementIdsByFragment.set(reference.fragment_id, ids);
      }
    }
  }
  const fragmentDisposition = Array.isArray(draft.fragment_disposition)
    ? draft.fragment_disposition.map((disposition) => isObject(disposition)
      ? {
          ...disposition,
          requirement_ids: typeof disposition.fragment_id === "string"
            ? (requirementIdsByFragment.get(disposition.fragment_id) ?? []).sort()
            : [],
        }
      : disposition)
    : draft.fragment_disposition;

  const collectionExecution = expandCollectionExecutionDraft(draft.collection_execution, draft.entities, errors);
  if (errors.length > 0) return { errors };
  const candidate: ProductSpec = {
    ...(draft as unknown as ProductSpec),
    ...(Object.hasOwn(draft, "version") ? {} : { version: "0.1" as const }),
    source_idea_hash: hashIdea(idea),
    source_fragments: sourceFragments,
    fragment_disposition: fragmentDisposition as ProductSpec["fragment_disposition"],
    requirements: requirements as ProductSpec["requirements"],
    acceptance_journeys: acceptanceJourneys as ProductSpec["acceptance_journeys"],
    conflicts: conflicts as ProductSpec["conflicts"],
    ...(Object.hasOwn(draft, "collection_execution") ? { collection_execution: collectionExecution as NonNullable<ProductSpec["collection_execution"]> } : {}),
  };
  return { candidate, errors: [] };
}
