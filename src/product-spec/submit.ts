import { writeFile } from "node:fs/promises";
import { expandProductSpecDraft } from "./draft.js";
import type { SourceFragment } from "./types.js";
import { validateProductSpec, type ProductSpecValidation } from "./validate.js";

export interface ProductSpecSubmission extends ProductSpecValidation {
  accepted: boolean;
}

export interface DraftReplacement {
  path: string;
  value: unknown;
}

/** Apply a small atomic replacement set to a retained semantic draft. Full validation still follows. */
export function replaceDraftValues(draft: unknown, replacements: DraftReplacement[]): unknown {
  if (draft === undefined) throw new Error("No draft is retained yet. Submit the complete draft first.");
  if (replacements.length < 1 || replacements.length > 32) throw new Error("Supply between 1 and 32 replacements.");
  const next = structuredClone(draft);
  for (const replacement of replacements) {
    if (!replacement.path.startsWith("/") || /~(?![01])/u.test(replacement.path)) {
      throw new Error(`Invalid JSON Pointer: ${replacement.path}`);
    }
    const parts = replacement.path.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
      throw new Error(`Unsupported replacement path: ${replacement.path}`);
    }
    let parent: unknown = next;
    for (const [index, part] of parts.entries()) {
      if (typeof parent !== "object" || parent === null || !Object.hasOwn(parent, part)
        || (Array.isArray(parent) && !/^(0|[1-9][0-9]*)$/u.test(part))) {
        throw new Error(`Replacement path does not identify an existing value: ${replacement.path}`);
      }
      const object = parent as Record<string, unknown>;
      if (index === parts.length - 1) object[part] = structuredClone(replacement.value);
      else parent = object[part];
    }
  }
  return next;
}

export async function submitProductSpecCandidate(
  specJson: string,
  idea: string,
  fragments: SourceFragment[],
  outputFile: string,
): Promise<ProductSpecSubmission> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(specJson) as unknown;
  } catch (error) {
    return {
      accepted: false,
      valid: false,
      errors: [`candidate is not valid JSON: ${(error as Error).message}`],
    };
  }

  const validation = validateProductSpec(candidate, idea, fragments);
  if (!validation.valid || !validation.spec) return { accepted: false, ...validation };
  await writeFile(outputFile, `${JSON.stringify(validation.spec, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { accepted: true, ...validation };
}

export async function submitProductSpecDraftCandidate(
  draftJson: string,
  idea: string,
  fragments: SourceFragment[],
  outputFile: string,
): Promise<ProductSpecSubmission> {
  let draft: unknown;
  try {
    draft = JSON.parse(draftJson) as unknown;
  } catch (error) {
    return {
      accepted: false,
      valid: false,
      errors: [`draft is not valid JSON: ${(error as Error).message}`],
    };
  }
  const expansion = expandProductSpecDraft(draft, idea, fragments);
  if (!expansion.candidate) {
    return { accepted: false, valid: false, errors: expansion.errors };
  }
  const validation = validateProductSpec(expansion.candidate, idea, fragments);
  if (!validation.valid || !validation.spec) return { accepted: false, ...validation };
  await writeFile(outputFile, `${JSON.stringify(validation.spec, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { accepted: true, ...validation };
}
