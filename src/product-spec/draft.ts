import { hashIdea } from "./fragments.js";
import type { ProductSpec, SourceFragment, SourceReference } from "./types.js";

type JsonObject = Record<string, unknown>;

export interface ProductSpecDraftExpansion {
  candidate?: unknown;
  errors: string[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
        return {
          ...requirement,
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

  if (errors.length > 0) return { errors };
  const candidate: ProductSpec = {
    ...(draft as unknown as ProductSpec),
    source_idea_hash: hashIdea(idea),
    source_fragments: sourceFragments,
    requirements: requirements as ProductSpec["requirements"],
    conflicts: conflicts as ProductSpec["conflicts"],
  };
  return { candidate, errors: [] };
}
