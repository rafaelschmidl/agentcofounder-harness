export const BUILD_PLAN_VERSION = "0.1" as const;

export type FileOwner = "BLOCK" | "AGENT" | "LINKER";

export interface PlannedBlock {
  id: string;
  version: string;
  order: number;
  config: Record<string, unknown>;
}

export interface CustomSlot {
  id: string;
  purpose: string;
  requirement_ids: string[];
  required_interfaces: string[];
  permitted_paths: string[];
}

export interface FileOwnership {
  path: string;
  owner: FileOwner;
  owner_id: string;
}

export interface RequirementImplementation {
  requirement_id: string;
  block_ids: string[];
  custom_slot_ids: string[];
}

export interface VerificationObligation {
  id: string;
  journey_id: string;
  requirement_ids: string[];
  checks: string[];
}

export interface BuildPlan {
  version: typeof BUILD_PLAN_VERSION;
  product_spec_hash: string;
  blocks: PlannedBlock[];
  custom_slots: CustomSlot[];
  file_ownership: FileOwnership[];
  dependencies: {
    runtime: string[];
    development: string[];
    install_allowed: false;
  };
  routes: Array<{
    path: string;
    component: string;
  }>;
  exports: Array<{
    from: string;
    names: string[];
  }>;
  requirement_mapping: RequirementImplementation[];
  verification_obligations: VerificationObligation[];
}

export interface MaterializedFile {
  path: string;
  content: string;
}

export interface CapabilityBlock {
  id: string;
  version: string;
  config_schema: Record<string, unknown>;
  capabilities: string[];
  dependencies: string[];
  conflicts: string[];
  owned_files: string[];
  exported_interfaces: string[];
  checks: string[];
  materialize(config: Record<string, unknown>): MaterializedFile[];
}
