import { hashIdea, segmentIdea } from "../../src/product-spec/fragments.js";
import type { ProductSpec } from "../../src/product-spec/types.js";

export const SAMPLE_IDEA = "I want to add personal notes and keep them after a refresh.";

export function validProductSpec(idea = SAMPLE_IDEA): ProductSpec {
  const fragments = segmentIdea(idea);
  const fragment = fragments[0];
  if (!fragment) throw new Error("Test idea must produce a fragment");

  return {
    version: "0.1",
    source_idea_hash: hashIdea(idea),
    source_fragments: fragments,
    fragment_disposition: fragments.map((item) => ({
      fragment_id: item.id,
      classification: "USED",
      requirement_ids: ["req_notes"],
      note: "The fragment directly defines the record and persistence behavior.",
    })),
    product: {
      summary: "A local personal note collection.",
      actors: [{ id: "actor_owner", name: "Owner", description: "The sole local user." }],
      goals: ["Capture and retain personal notes."],
      constraints: ["Remain a local single-user tool."],
    },
    requirements: [
      {
        id: "req_notes",
        title: "Capture notes",
        description: "The owner can add a personal note and see it in the collection.",
        kind: "FUNCTIONAL",
        provenance: "EXPLICIT",
        disposition: "IMPLEMENT",
        source_refs: [
          {
            fragment_id: fragment.id,
            start: fragment.start,
            end: fragment.end,
            quote: fragment.text,
          },
        ],
        journey_ids: ["journey_add_note"],
      },
      {
        id: "req_validation",
        title: "Reject empty notes",
        description: "An empty note is rejected with visible feedback.",
        kind: "ROBUSTNESS",
        provenance: "DEFAULT",
        disposition: "IMPLEMENT",
        source_refs: [],
        journey_ids: ["journey_validate_note"],
      },
    ],
    entities: [
      {
        id: "entity_note",
        name: "Note",
        description: "A personal note record.",
        fields: [
          {
            id: "field_text",
            name: "Text",
            type: "string",
            required: true,
            values: [],
            validation: ["Must contain non-whitespace text."],
          },
        ],
        relationships: [],
        validation: ["Text is required."],
      },
    ],
    workflows: [],
    persistence: {
      mode: "LOCAL",
      data: ["notes"],
      constraints: ["Recover safely from malformed stored data."],
    },
    integrations: [],
    views: [
      {
        id: "view_notes",
        name: "Notes",
        purpose: "Create and browse notes.",
        states: ["empty", "populated", "validation-error"],
        requirement_ids: ["req_notes", "req_validation"],
      },
    ],
    acceptance_journeys: [
      {
        id: "journey_add_note",
        title: "Add a note",
        actor_id: "actor_owner",
        steps: ["Enter a complete note.", "Save it."],
        expected_outcomes: ["The note appears in the collection."],
        requirement_ids: ["req_notes"],
      },
      {
        id: "journey_validate_note",
        title: "Reject an empty note",
        actor_id: "actor_owner",
        steps: ["Submit an empty note."],
        expected_outcomes: ["The note is not saved and feedback is visible."],
        requirement_ids: ["req_validation"],
      },
    ],
    assumptions: ["A textarea is sufficient for the first version."],
    exclusions: [],
    conflicts: [],
    selected_patterns: ["crud.collection@1.0.0", "persistence.local@1.0.0"],
  };
}
