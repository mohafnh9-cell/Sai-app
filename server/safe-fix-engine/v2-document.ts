import {
  buildProductionFixPrompt,
  projectedScoreAfterFix,
} from "@/brain/fix-prompt/build-production-fix-prompt";
import { guidanceForCategory } from "@/brain/fix-prompt/category-guidance";
import type { ProductionFixPromptInput } from "@/brain/fix-prompt/types";
import type { SafeFixAssessment } from "@/brain/fix-prompt/assessment";
import type { SafeFixDocumentV2, SafeFixConfidenceBand } from "./types";
import { trustNarrativeForBand } from "./confidence";

export function buildSafeFixDocumentV2(input: {
  promptInput: ProductionFixPromptInput;
  assessment: SafeFixAssessment;
  fixPrompt: string;
  confidenceBand: SafeFixConfidenceBand;
}): SafeFixDocumentV2 {
  const guidance = guidanceForCategory(input.promptInput.category);
  const projectedDelta = input.promptInput.projectedScoreImpact ?? null;
  const projectedScore = projectedScoreAfterFix(input.promptInput);

  const rootCause = [
    input.promptInput.issueDescription,
    input.promptInput.recommendedAction
      ? `Recommended direction: ${input.promptInput.recommendedAction}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const explanationNarrative = [
    `${input.promptInput.issueTitle} — ${input.assessment.riskReason}`,
    "",
    "If this were my company, I would fix this before deploying.",
    "",
    `I have prepared a Safe Fix that limits the change to ${input.promptInput.affectedFiles.length || 1} focused area(s), minimising regression risk.`,
    "",
    trustNarrativeForBand(input.confidenceBand),
  ].join("\n");

  return {
    executiveSummary: `${input.promptInput.issueTitle} (${input.promptInput.severity}) — ${input.assessment.implementationRisk} implementation risk, Safe Fix confidence ${input.confidenceBand}.`,
    rootCause,
    whyThisMatters: input.promptInput.whyItMatters,
    riskIfIgnored: input.promptInput.estimatedImpact ?? input.assessment.riskReason,
    proposedImplementation: input.promptInput.recommendedAction,
    filesToChange:
      input.promptInput.affectedFiles.length > 0
        ? input.promptInput.affectedFiles
        : ["Review the codebase area related to this blocker."],
    expectedProductionConfidenceImprovement: projectedDelta,
    expectedProtectionImpact:
      projectedScore >= 85
        ? "Likely moves protection toward PROTECTED after verification."
        : "Improves readiness; may remain SAFE WITH CAUTION until follow-up review.",
    expectedSecurityImprovement:
      input.promptInput.category.toLowerCase().includes("auth") ||
      input.promptInput.category.toLowerCase().includes("security")
        ? "Reduces exposed attack surface in authentication/security paths."
        : "Supports overall security confidence by clearing a production blocker.",
    verificationChecklist: [
      ...guidance.regressionTests.slice(0, 3),
      "Run project build and tests.",
      "Ask SequrAI to review again after applying.",
    ],
    rollbackConsiderations: [
      "Revert the commit if tests fail or behaviour regresses.",
      "Keep the previous middleware/config handy for a fast rollback.",
      guidance.doNotModify.length
        ? `Avoid rolling back unrelated files listed as do-not-modify: ${guidance.doNotModify.slice(0, 2).join(", ")}`
        : "Document the change in your PR for easy revert.",
    ],
    cursorPrompt: input.fixPrompt,
    explanationNarrative,
  };
}

export function buildFromPromptInput(
  promptInput: ProductionFixPromptInput,
  confidenceBand: SafeFixConfidenceBand
): { document: SafeFixDocumentV2; assessment: SafeFixAssessment; prompt: string } {
  const { prompt, assessment } = buildProductionFixPrompt(promptInput);
  const document = buildSafeFixDocumentV2({
    promptInput,
    assessment,
    fixPrompt: prompt,
    confidenceBand,
  });
  return { document, assessment, prompt };
}
