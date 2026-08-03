import type { AttackEvidence } from "../contracts/attack-evidence";
import type { AttackFinding } from "../contracts/attack-finding";
import type { CreateAttackMitigationInput } from "../contracts/attack-mitigation";
import type { AttackScenario } from "../contracts/attack-scenario";
import { evidenceReportFromMetadata } from "@/brain/evidence-finding/schema";
import {
  analyzeProjectContext,
  projectAwareRecommendation,
  resolveExistingAffectedFiles,
} from "@/brain/evidence-finding/project-context";
import { getMitigationTemplate } from "./evaluate-outcome";

export function buildAttackMitigationInput(input: {
  finding: Pick<AttackFinding, "id" | "executionId" | "campaignId" | "organizationId" | "projectId" | "rootCause" | "metadata">;
  scenario: Pick<AttackScenario, "adapterId" | "title">;
  evidence: Pick<AttackEvidence, "confidence" | "replayInstructions" | "reproducibility">;
  projectFilePaths?: readonly string[];
}): CreateAttackMitigationInput {
  const template = getMitigationTemplate(input.scenario.adapterId);
  const rootCause = input.finding.rootCause ?? template.rootCause;
  const report = evidenceReportFromMetadata(input.finding.metadata ?? null);
  const projectContext = analyzeProjectContext(input.projectFilePaths ?? []);
  const likelyAffectedFiles = resolveExistingAffectedFiles(template.likelyAffectedFiles, projectContext);
  const recommendedProtection = projectAwareRecommendation({
    genericRecommendation: template.recommendedProtection,
    context: projectContext,
    adapterId: input.scenario.adapterId,
  });
  const statusLabel = report?.statusLabel ?? "Review required";

  return {
    findingId: input.finding.id,
    executionId: input.finding.executionId,
    campaignId: input.finding.campaignId,
    organizationId: input.finding.organizationId,
    projectId: input.finding.projectId,
    plainLanguageExplanation: [
      `Security test result for "${input.scenario.title}": ${statusLabel}.`,
      rootCause,
      report?.reasoning ?? `Replay context: ${input.evidence.reproducibility}`,
    ].join(" "),
    rootCause,
    recommendedProtection,
    likelyAffectedFiles,
    implementationSteps: [...template.implementationSteps],
    implementationRisk: template.implementationRisk,
    safeFixConfidence: report?.safeFixConfidence ?? Math.min(0.95, Number((input.evidence.confidence + 0.05).toFixed(3))),
    estimatedLoc: template.estimatedLoc,
    rollbackGuidance: template.rollbackGuidance,
    residualRisk: template.residualRisk,
    metadata: {
      adapterId: input.scenario.adapterId,
      replayInstructions: input.evidence.replayInstructions,
      detectionMethod: report?.detectionMethod,
      evidenceReport: report,
    },
  };
}
