import { writeFile } from "node:fs/promises";
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
