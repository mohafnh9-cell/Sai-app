import type { ProductionFixPromptInput } from "@/brain/fix-prompt/types";
import { guardUntrustedInput } from "./input-guard";

function guardField(
  value: string,
  source: "finding_field" | "dependency_metadata",
  path: string
): string {
  return guardUntrustedInput(value, { source, path, forceWrap: true }).forPrompt;
}

/** Capa A for Safe Fix prompt assembly — repo-derived fields are data, never instructions. */
export function sanitizeProductionFixPromptInput(
  input: ProductionFixPromptInput
): ProductionFixPromptInput {
  const basePath = input.affectedFiles[0] ?? "safe-fix-input";

  return {
    ...input,
    issueTitle: guardField(input.issueTitle, "finding_field", `${basePath}#title`),
    issueDescription: guardField(input.issueDescription, "finding_field", `${basePath}#description`),
    whyItMatters: guardField(input.whyItMatters, "finding_field", `${basePath}#why`),
    recommendedAction: guardField(
      input.recommendedAction,
      "finding_field",
      `${basePath}#recommendedAction`
    ),
    estimatedImpact: input.estimatedImpact
      ? guardField(input.estimatedImpact, "finding_field", `${basePath}#impact`)
      : input.estimatedImpact,
  };
}
