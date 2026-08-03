import type { AttackEvidence } from "../contracts/attack-evidence";
import type { CreateAttackFindingInput } from "../contracts/attack-finding";
import type { AttackCampaign } from "../contracts/attack-campaign";
import type { AttackExecution } from "../contracts/attack-execution";
import type { AttackScenario } from "../contracts/attack-scenario";
import type { AttackOutcomeEvaluation } from "./evaluate-outcome";
import {
  attachEvidenceReportToMetadata,
  buildAttackEvidenceReport,
} from "@/brain/evidence-finding/enrich-attack-finding";

export function buildAttackFindingInput(input: {
  campaign: Pick<AttackCampaign, "id" | "organizationId" | "projectId">;
  execution: Pick<AttackExecution, "id">;
  scenario: Pick<AttackScenario, "id" | "title" | "description" | "category" | "hypothesisId" | "adapterId">;
  evidence: Pick<
    AttackEvidence,
    | "id"
    | "confidence"
    | "expectedBehavior"
    | "observedBehavior"
    | "statusCode"
    | "sideEffects"
    | "reproducibility"
    | "redactedRequest"
    | "redactedResponse"
  >;
  evaluation: AttackOutcomeEvaluation;
  runtimeMode: AttackCampaign["runtimeMode"];
  projectFilePaths?: readonly string[];
}): CreateAttackFindingInput {
  const evidenceReport = buildAttackEvidenceReport({
    scenario: input.scenario,
    evidence: input.evidence,
    evaluation: input.evaluation,
    runtimeMode: input.runtimeMode,
    projectFilePaths: input.projectFilePaths,
  });

  return {
    executionId: input.execution.id,
    campaignId: input.campaign.id,
    scenarioId: input.scenario.id,
    organizationId: input.campaign.organizationId,
    projectId: input.campaign.projectId,
    evidenceId: input.evidence.id,
    title: input.scenario.title,
    description: input.scenario.description || input.evaluation.rationale,
    category: input.scenario.category,
    severity: input.evaluation.severity,
    confidence: evidenceReport.confidence,
    outcome: input.evaluation.outcome,
    impact: input.evaluation.impact,
    rootCause: input.evaluation.rootCause,
    metadata: attachEvidenceReportToMetadata(
      {
        adapterId: input.scenario.adapterId,
        hypothesisId: input.scenario.hypothesisId,
        rationale: input.evaluation.rationale,
        exploitable: input.evaluation.exploitable,
        confirmationStatus: input.evaluation.confirmationStatus,
        statusLabel: evidenceReport.statusLabel,
      },
      evidenceReport
    ),
  };
}
