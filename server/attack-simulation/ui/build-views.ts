import type { AttackCampaign } from "../contracts/attack-campaign";
import type { AttackExecution } from "../contracts/attack-execution";
import type { AttackExecutionStep } from "../contracts/attack-execution-step";
import type { AttackEvidence } from "../contracts/attack-evidence";
import type { AttackFinding } from "../contracts/attack-finding";
import type { AttackMitigation } from "../contracts/attack-mitigation";
import type { AttackRuntimeEvent } from "../contracts/attack-runtime-event";
import type { AttackSafeFix } from "../contracts/attack-safe-fix";
import type { AttackScenario } from "../contracts/attack-scenario";
import type { ProtectionVerification } from "../contracts/protection-verification";
import type {
  AttackCenterCampaignView,
  AttackCenterExecutionView,
  AttackCenterFeedItem,
  AttackCenterFindingView,
} from "./types";

function buildFeed(events: AttackRuntimeEvent[]): AttackCenterFeedItem[] {
  return events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    executionId: event.executionId,
    stepId: event.stepId,
    label: formatFeedLabel(event),
  }));
}

function formatFeedLabel(event: AttackRuntimeEvent): string {
  const stepLabel = typeof event.payload.stepLabel === "string" ? event.payload.stepLabel : null;
  switch (event.eventType) {
    case "attack_planned":
      return "Attack scenarios planned";
    case "attack_execution_started":
      return "Attack execution started";
    case "attack_step_started":
      return stepLabel ? `Step started: ${stepLabel}` : "Attack step started";
    case "attack_step_completed":
      return stepLabel ? `Step completed: ${stepLabel}` : "Attack step completed";
    case "attack_evidence_collected":
      return "Evidence collected";
    case "attack_confirmed":
      return "Vulnerability confirmed";
    case "attack_not_exploitable":
      return "Attack not exploitable";
    case "attack_blocked":
      return "Attack blocked by Safe Runtime";
    case "safe_fix_ready":
      return "Safe Fix ready";
    case "attack_replay_started":
      return "Protection replay started";
    case "protection_verified":
      return "Protection verified";
    case "attack_still_vulnerable":
      return "Application still vulnerable";
    case "attack_failed":
      return "Attack failed";
    case "attack_cancelled":
      return "Attack cancelled";
    default:
      return event.eventType.replaceAll("_", " ");
  }
}

export function buildAttackCenterCampaignView(input: {
  projectId: string;
  campaign: AttackCampaign;
  executions: AttackExecution[];
  scenarios: AttackScenario[];
  events: AttackRuntimeEvent[];
}): AttackCenterCampaignView {
  const scenarioById = new Map(input.scenarios.map((scenario) => [scenario.id, scenario]));

  return {
    kind: "campaign",
    projectId: input.projectId,
    campaign: {
      id: input.campaign.id,
      status: input.campaign.status,
      commitSha: input.campaign.commitSha,
      runtimeMode: input.campaign.runtimeMode,
      progressPercent: input.campaign.progressPercent,
      estimatedRemainingMs: input.campaign.estimatedRemainingMs,
      totalScenarios: input.campaign.totalScenarios,
      totalExecutions: input.campaign.totalExecutions,
      completedExecutions: input.campaign.completedExecutions,
      confirmedFindings: input.campaign.confirmedFindings,
      blockedExecutions: input.campaign.blockedExecutions,
      updatedAt: input.campaign.updatedAt,
    },
    executions: input.executions.map((execution) => {
      const scenario = scenarioById.get(execution.scenarioId);
      return {
        id: execution.id,
        scenarioId: execution.scenarioId,
        scenarioTitle: scenario?.title ?? "Attack scenario",
        adapterId: scenario?.adapterId ?? "unknown",
        status: execution.status,
        progressPercent: execution.progressPercent,
        estimatedRemainingMs: execution.estimatedRemainingMs,
        currentStepTitle: execution.currentStepTitle,
      };
    }),
    feed: buildFeed(input.events),
  };
}

export function buildAttackCenterExecutionView(input: {
  projectId: string;
  execution: AttackExecution;
  steps: AttackExecutionStep[];
  events: AttackRuntimeEvent[];
}): AttackCenterExecutionView {
  return {
    kind: "execution",
    projectId: input.projectId,
    execution: {
      id: input.execution.id,
      campaignId: input.execution.campaignId,
      scenarioId: input.execution.scenarioId,
      status: input.execution.status,
      progressPercent: input.execution.progressPercent,
      estimatedRemainingMs: input.execution.estimatedRemainingMs,
      currentStepTitle: input.execution.currentStepTitle,
      elapsedMs: input.execution.elapsedMs,
    },
    steps: input.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      label: step.label,
      status: step.status,
      sortOrder: step.sortOrder,
      weight: step.weight,
      durationMs: step.durationMs,
    })),
    feed: buildFeed(input.events),
  };
}

export function buildAttackCenterFindingView(input: {
  projectId: string;
  finding: AttackFinding;
  mitigation: AttackMitigation | null;
  safeFix: AttackSafeFix | null;
  evidence: AttackEvidence | null;
  verification: ProtectionVerification | null;
}): AttackCenterFindingView {
  return {
    kind: "finding",
    projectId: input.projectId,
    finding: {
      id: input.finding.id,
      title: input.finding.title,
      description: input.finding.description,
      category: input.finding.category,
      severity: input.finding.severity,
      outcome: input.finding.outcome,
      confidence: input.finding.confidence,
      impact: input.finding.impact,
      rootCause: input.finding.rootCause,
    },
    mitigation: input.mitigation
      ? {
          plainLanguageExplanation: input.mitigation.plainLanguageExplanation,
          recommendedProtection: input.mitigation.recommendedProtection,
          implementationSteps: input.mitigation.implementationSteps,
          implementationRisk: input.mitigation.implementationRisk,
        }
      : null,
    safeFix: input.safeFix
      ? {
          id: input.safeFix.id,
          status: input.safeFix.status,
          cursorPrompt: input.safeFix.cursorPrompt,
          confidence: input.safeFix.confidence,
          attackFindingId: input.finding.id,
        }
      : null,
    evidence: input.evidence
      ? {
          expectedBehavior: input.evidence.expectedBehavior,
          observedBehavior: input.evidence.observedBehavior,
          reproducibility: input.evidence.reproducibility,
        }
      : null,
    protection: input.verification
      ? {
          outcome: input.verification.outcome,
          summary:
            typeof input.verification.comparison.summary === "string"
              ? input.verification.comparison.summary
              : input.verification.outcome,
        }
      : null,
  };
}
