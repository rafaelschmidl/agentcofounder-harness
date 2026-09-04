import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPi, type CommandResult } from "../pi-runner.js";
import { providerFromEnvironment, providerPiArguments } from "../provider.js";
import { createPiEnvironment } from "../pi-environment.js";
import { hashIdea, segmentIdea } from "./fragments.js";
import type { ProductSpec, SourceFragment } from "./types.js";
import { validateProductSpec } from "./validate.js";
import { executableCollectionEnabled } from "../executable-collection/types.js";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SOURCE_DIRECTORY, "../..");
export const DEFAULT_INTERPRETER_THINKING = "off";
const EXECUTABLE_COLLECTION_INSTRUCTION = `

## Executable collection
Keep canonical ProductSpec semantics and provenance. Submit collection_execution: choose compiled only for one flat local string/enum collection whose complete rules fit the contract; otherwise custom with the unsupported reason. Never drop requirements to fit.
Define canonical entity fields once. Draft contract.fields accepts exact IDs, e.g. ["field_title","field_category"], or {key:"field_priority",initial:"medium"}. Omitted label/type/required/options derive from that field. Full objects remain valid; explicit metadata is preserved and validated. Use exact canonical IDs in hidden state, guards and assignments. Hidden fields need explicit initial values; omitted required/choices derive canonically. Workflow-controlled state belongs in hidden so ordinary editing preserves it. Generated identifiers map to record.id; never make them editable/hidden. Do not invent redundant state, dates, fields or closed enums from examples. Map domain requirement_ids to IMPLEMENT requirements; presentation stays in the UI, and SCOPE constraints need no fabricated journey.
Actions declare input fields, additional when guards, assignments and literal success messages. Input fields are full objects with their own required rules: an action may require a value optional in stored records. Guards support conjunctions of equals/empty/present; invariants mean when implies must and apply to stored records and successful mutations. For a workflow, state_binding maps every canonical state to hidden-field predicates; each action names its canonical transition_id exactly once. The compiler derives source/target guards. Empty/present predicates on one hidden field may avoid a redundant status enum. Enum choices and conditional invariants can coexist. Preserve predicates and invariants when fixing alignment errors.
Repair the retained draft, not a full rewrite. Correct derived metadata in the canonical entity field. Replacements target existing values only: adding an array entry or omitted property requires replacing its existing parent array/object.
Choose custom for relations, transactions, external/async effects, numeric/date validation, format/pattern/length rules beyond nonempty checks, cross-record constraints, unsupported formulas/invariants, multiple collections or workflows. Audit every field validation, workflow guard/effect and invariant against supported operators. The compiler supplies domain.ts; product UI and actual journey tests remain generated separately.
`;

export function interpreterThinkingFromEnvironment(): string {
  return process.env.CHALLENGE_INTERPRETER_THINKING
    ?? process.env.CHALLENGE_THINKING
    ?? DEFAULT_INTERPRETER_THINKING;
}

export interface ProductSpecInterpretationResult {
  command: CommandResult;
  spec?: ProductSpec;
  errors: string[];
  files: {
    idea: string;
    fragments: string;
    productSpec: string;
    patternAudit: string;
    events: string;
    stderr: string;
  };
}

export function buildInterpreterPiArguments(
  idea: string,
  fragments: SourceFragment[],
  systemPrompt: string,
  artifactDirectory: string,
): string[] {
  const provider = providerFromEnvironment();
  const args = [
    "--mode",
    "json",
    "--print",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-builtin-tools",
    "--tools",
    "retrieve_patterns,submit_product_spec",
    "--system-prompt",
    systemPrompt.trim() + (executableCollectionEnabled() ? EXECUTABLE_COLLECTION_INSTRUCTION : ""),
    "--session-dir",
    path.join(artifactDirectory, "sessions"),
    "--extension",
    path.join(REPOSITORY_ROOT, "solution", "extensions", "product-spec-interpreter.ts"),
    ...providerPiArguments(provider.provider, provider.model),
    "--thinking",
    interpreterThinkingFromEnvironment(),
    [
      "## Raw product idea",
      idea,
      "",
      `## Source idea hash\n${hashIdea(idea)}`,
      "",
      "## Immutable source fragments",
      JSON.stringify(fragments, null, 2),
      "",
      "Retrieve relevant patterns, then submit the complete ProductSpec v0.1.",
    ].join("\n"),
  ];
  return args;
}

export async function runProductSpecInterpretation(
  idea: string,
  artifactDirectory: string,
  timeoutMs: number,
): Promise<ProductSpecInterpretationResult> {
  const files = {
    idea: path.join(artifactDirectory, "idea.txt"),
    fragments: path.join(artifactDirectory, "source_fragments.json"),
    productSpec: path.join(artifactDirectory, "idea_spec.json"),
    patternAudit: path.join(artifactDirectory, "pattern-retrieval.jsonl"),
    events: path.join(artifactDirectory, "interpreter.events.jsonl"),
    stderr: path.join(artifactDirectory, "interpreter.stderr.log"),
  };
  const fragments = segmentIdea(idea);
  const systemPrompt = await readFile(path.join(REPOSITORY_ROOT, "solution", "interpreter-prompt.md"), "utf8");
  await mkdir(path.join(artifactDirectory, "sessions"), { recursive: true });
  await Promise.all([
    writeFile(files.idea, idea, { encoding: "utf8", flag: "wx" }),
    writeFile(files.fragments, `${JSON.stringify(fragments, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
    writeFile(files.patternAudit, "", { encoding: "utf8", flag: "wx" }),
  ]);

  const environment = await createPiEnvironment(artifactDirectory, {
    CHALLENGE_EXECUTABLE_COLLECTION: executableCollectionEnabled() ? "1" : undefined,
    SYSTEM_V0_IDEA_FILE: files.idea,
    SYSTEM_V0_FRAGMENTS_FILE: files.fragments,
    SYSTEM_V0_PRODUCT_SPEC_FILE: files.productSpec,
    SYSTEM_V0_PATTERN_AUDIT_FILE: files.patternAudit,
  });
  const command = await runPi(
    buildInterpreterPiArguments(
      idea,
      fragments,
      systemPrompt,
      artifactDirectory,
    ),
    REPOSITORY_ROOT,
    files.events,
    files.stderr,
    timeoutMs,
    environment,
    16,
  );

  let candidate: unknown;
  try {
    candidate = JSON.parse(await readFile(files.productSpec, "utf8")) as unknown;
  } catch (error) {
    return {
      command,
      errors: [`interpreter did not produce a readable idea_spec.json: ${(error as Error).message}`],
      files,
    };
  }
  const validation = validateProductSpec(candidate, idea, fragments);
  if (!validation.spec) return { command, errors: validation.errors, files };
  return { command, spec: validation.spec, errors: validation.errors, files };
}
