import type { AttackEvidence } from "../contracts/attack-evidence";
import type { AttackFinding } from "../contracts/attack-finding";
import type { CreateAttackMitigationInput } from "../contracts/attack-mitigation";
import type { AttackScenario } from "../contracts/attack-scenario";
import { getMitigationTemplate } from "./evaluate-outcome";

export function buildAttackMitigationInput(input: {
  finding: Pick<AttackFinding, "id" | "executionId" | "campaignId" | "organizationId" | "projectId" | "rootCause">;
  scenario: Pick<AttackScenario, "adapterId" | "title">;
  evidence: Pick<AttackEvidence, "confidence" | "replayInstructions" | "reproducibility">;
}): CreateAttackMitigationInput {
  const template = getMitigationTemplate(input.scenario.adapterId);
  const rootCause = input.finding.rootCause ?? template.rootCause;

  return {
    findingId: input.finding.id,
    executionId: input.finding.executionId,
    campaignId: input.finding.campaignId,
    organizationId: input.finding.organizationId,
    projectId: input.finding.projectId,
    plainLanguageExplanation: [
      `Attack simulation confirmed a protection gap for "${input.scenario.title}".`,
      rootCause,
      `Replay context: ${input.evidence.reproducibility}`,
    ].join(" "),
    rootCause,
    recommendedProtection: template.recommendedProtection,
    likelyAffectedFiles: [...template.likelyAffectedFiles],
    implementationSteps: [...template.implementationSteps],
    implementationRisk: template.implementationRisk,
    safeFixConfidence: Math.min(0.95, Number((input.evidence.confidence + 0.05).toFixed(3))),
    estimatedLoc: template.estimatedLoc,
    rollbackGuidance: template.rollbackGuidance,
    residualRisk: template.residualRisk,
    metadata: {
      adapterId: input.scenario.adapterId,
      replayInstructions: input.evidence.replayInstructions,
    },
  };
}
