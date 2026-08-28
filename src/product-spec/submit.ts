import { writeFile } from "node:fs/promises";
import { expandProductSpecDraft } from "./draft.js";
import type { SourceFragment } from "./types.js";
import { validateProductSpec, type ProductSpecValidation } from "./validate.js";

export interface ProductSpecSubmission extends ProductSpecValidation {
  accepted: boolean;
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
