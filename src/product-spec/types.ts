export const PRODUCT_SPEC_VERSION = "0.1" as const;

export type RequirementProvenance =
  | "EXPLICIT"
  | "IMPLIED"
  | "DEFAULT"
  | "PROPOSED"
  | "EXCLUDED";

export type RequirementDisposition = "IMPLEMENT" | "PROPOSE" | "EXCLUDE";

export interface SourceFragment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface SourceReference {
  fragment_id: string;
  start: number;
  end: number;
  quote: string;
}

export interface FragmentDisposition {
  fragment_id: string;
  classification: "USED" | "CONTEXT" | "CONSTRAINT" | "AMBIGUOUS" | "EXCLUDED";
  requirement_ids: string[];
  note: string;
}

export interface Actor {
  id: string;
  name: string;
  description: string;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  kind: "FUNCTIONAL" | "PERSISTENCE" | "ROBUSTNESS" | "INTEGRATION" | "SCOPE";
  provenance: RequirementProvenance;
  disposition: RequirementDisposition;
  source_refs: SourceReference[];
  journey_ids: string[];
}

export interface EntityField {
  id: string;
  name: string;
  type: "string" | "number" | "boolean" | "date" | "enum" | "identifier";
  required: boolean;
  values: string[];
  validation: string[];
}

export interface Entity {
  id: string;
  name: string;
  description: string;
  fields: EntityField[];
  relationships: string[];
  validation: string[];
}

export interface WorkflowTransition {
  id: string;
  from: string;
  to: string;
  trigger: string;
  guards: string[];
  effects: string[];
}

export interface Workflow {
  id: string;
  name: string;
  entity_id: string;
  initial_state: string;
  states: string[];
  transitions: WorkflowTransition[];
  invariants: string[];
}

export interface IntegrationNeed {
  id: string;
  kind: string;
  mode: "NONE" | "STUB" | "LOCAL" | "EXTERNAL";
  description: string;
  requirement_ids: string[];
}

export interface View {
  id: string;
  name: string;
  purpose: string;
  states: string[];
  requirement_ids: string[];
}

export interface AcceptanceJourney {
  id: string;
  title: string;
  actor_id: string;
  steps: string[];
  expected_outcomes: string[];
  requirement_ids: string[];
}

export interface ProductSpec {
  version: typeof PRODUCT_SPEC_VERSION;
  source_idea_hash: string;
  source_fragments: SourceFragment[];
  fragment_disposition: FragmentDisposition[];
  product: {
    summary: string;
    experience?: {
      name: string;
      visual_direction: string;
      composition: string;
      interaction_priorities: string[];
    };
    actors: Actor[];
    goals: string[];
    constraints: string[];
  };
  requirements: Requirement[];
  entities: Entity[];
  workflows: Workflow[];
  persistence: {
    mode: "NONE" | "LOCAL" | "EXTERNAL";
    data: string[];
    constraints: string[];
  };
  integrations: IntegrationNeed[];
  views: View[];
  acceptance_journeys: AcceptanceJourney[];
  assumptions: string[];
  exclusions: string[];
  conflicts: Array<{
    description: string;
    source_refs: SourceReference[];
    resolution: string;
  }>;
  selected_patterns: string[];
}
