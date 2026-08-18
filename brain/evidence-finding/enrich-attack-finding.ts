import type { AttackRuntimeMode } from "@/server/attack-simulation/contracts/enums";
import type { AttackEvidence } from "@/server/attack-simulation/contracts/attack-evidence";
import type { AttackOutcomeEvaluation } from "@/server/attack-simulation/mitigation/evaluate-outcome";
import type { AttackScenario } from "@/server/attack-simulation/contracts/attack-scenario";
import type { EvidenceCaptureBuffer } from "@/server/attack-simulation/evidence/capture-buffer";
import type { DetectionMethod, EvidenceItem, EvidenceReport } from "./schema";
import { lookupRuleInfo } from "./rule-catalog";
import { computeConfidenceScore, confidencePercent } from "./compute-confidence";
import { deriveConfidenceFromEvidenceScore } from "@/brain/confidence/derive";
import {
  computeFalsePositiveProbability,
  falsePositiveLabel,
  falsePositivePercent,
} from "./compute-false-positive";
import {
  analyzeProjectContext,
  projectAwareRecommendation,
  resolveExistingAffectedFiles,
} from "./project-context";
import { EVIDENCE_REPORT_METADATA_KEY } from "./schema";

export function runtimeModeToDetectionMethod(
  runtimeMode: AttackRuntimeMode,
  hasReplay: boolean
): DetectionMethod {
  if (hasReplay) return "REPLAY";
  switch (runtimeMode) {
    case "mock":
      return "MOCK_SIMULATION";
    case "static":
      return "STATIC_ANALYSIS";
    case "sandbox":
      return "DYNAMIC_ANALYSIS";
    case "authorized_staging":
      return "AUTHORIZED_STAGING";
    default:
      return "HYBRID";
  }
}

export function confirmationStatusForRuntime(input: {
  runtimeMode: AttackRuntimeMode;
  evaluation: Pick<AttackOutcomeEvaluation, "outcome" | "exploitable" | "confirmationStatus">;
}): EvidenceReport["confirmationStatus"] {
  if (input.evaluation.outcome === "not_exploitable") return "not_exploitable";
  if (!input.evaluation.exploitable) return "inconclusive";
  if (input.evaluation.confirmationStatus === "potential") return "potential_vulnerability";
  return "confirmed";
}

export function statusLabelForConfirmation(status: EvidenceReport["confirmationStatus"]): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "potential_vulnerability":
      return "Potential vulnerability";
    case "not_exploitable":
      return "Not exploitable";
    case "inconclusive":
      return "Inconclusive";
    case "suppressed":
      return "Suppressed";
  }
}

export function buildAttackEvidenceReport(input: {
  scenario: Pick<AttackScenario, "adapterId" | "title" | "description" | "category">;
  evidence: Pick<
    AttackEvidence,
    | "expectedBehavior"
    | "observedBehavior"
    | "statusCode"
    | "sideEffects"
    | "confidence"
    | "reproducibility"
    | "redactedRequest"
    | "redactedResponse"
  >;
  evaluation: AttackOutcomeEvaluation;
  runtimeMode: AttackRuntimeMode;
  projectFilePaths?: readonly string[];
  buffer?: EvidenceCaptureBuffer;
  hasReplayEvidence?: boolean;
}): EvidenceReport {
  const detectionMethod = runtimeModeToDetectionMethod(input.runtimeMode, Boolean(input.hasReplayEvidence));
  const confirmationStatus = confirmationStatusForRuntime({
    runtimeMode: input.runtimeMode,
    evaluation: input.evaluation,
  });
  const projectContext = analyzeProjectContext(input.projectFilePaths ?? []);

  const runtimeEvidence = buildRuntimeEvidenceItems(input.evidence, input.buffer);
  const evidenceItems: EvidenceItem[] = [
    {
      id: "expected",
      kind: "expected_behavior",
      label: "Expected behavior",
      detail: input.evidence.expectedBehavior,
      confidence: 0.9,
    },
    {
      id: "observed",
      kind: "observed_behavior",
      label: "Observed behavior",
      detail: input.evidence.observedBehavior,
      confidence: input.evidence.confidence,
    },
  ];
  if (input.evidence.statusCode != null) {
    evidenceItems.push({
      id: "http-status",
      kind: "http_response",
      label: "HTTP response",
      detail: `Status ${input.evidence.statusCode}`,
      confidence: 0.85,
    });
  }
  evidenceItems.push(...runtimeEvidence);

  const counterEvidence = buildAttackCounterEvidence(input.evaluation, input.runtimeMode, projectContext);
  const matchedRule = lookupRuleInfo(input.scenario.adapterId, input.scenario.title, input.scenario.category);

  const { confidence, explanation } = computeConfidenceScore({
    detectionMethod,
    evidenceItems,
    severity: input.evaluation.severity,
    hasRuntimeEvidence: runtimeEvidence.length > 0,
    hasReplayEvidence: Boolean(input.hasReplayEvidence),
    signalHits: input.evaluation.exploitSignalHits,
  });

  const verificationStatusForConfidence =
    confirmationStatus === "confirmed" ? ("CONFIRMED" as const) : ("POTENTIAL" as const);
  const { level: confidenceLevel } = deriveConfidenceFromEvidenceScore({
    detectionMethod,
    evidenceItems,
    severity: input.evaluation.severity,
    hasRuntimeEvidence: runtimeEvidence.length > 0,
    hasReplayEvidence: Boolean(input.hasReplayEvidence),
    signalHits: input.evaluation.exploitSignalHits,
    verificationStatus: verificationStatusForConfidence,
  });

  const { probability, explanation: fpExplanation } = computeFalsePositiveProbability({
    detectionMethod,
    evidenceItems,
    counterEvidenceItems: counterEvidence,
    projectType: projectContext.projectType,
    ruleId: input.scenario.adapterId,
    hasRuntimeUsage: runtimeEvidence.length > 0,
  });

  const affectedFiles = resolveExistingAffectedFiles(
    matchedRule.category === "authentication"
      ? projectContext.recommendedAuthPaths
      : [`server/**/${input.scenario.adapterId}/**`],
    projectContext
  );

  const recommendedFix = projectAwareRecommendation({
    genericRecommendation: input.evaluation.rootCause ?? input.scenario.description,
    context: projectContext,
    adapterId: input.scenario.adapterId,
  });

  return {
    version: 1,
    detectionMethod,
    confidence,
    confidenceLevel,
    confidencePercent: confidencePercent(confidence),
    confidenceExplanation: explanation,
    falsePositiveProbability: probability,
    falsePositivePercent: falsePositivePercent(probability),
    falsePositiveExplanation: `${falsePositiveLabel(probability)} — ${fpExplanation}`,
    confirmationStatus,
    statusLabel: statusLabelForConfirmation(confirmationStatus),
    evidence: evidenceItems,
    counterEvidence,
    reasoning: input.evaluation.rationale,
    affectedFiles: affectedFiles.map((path) => ({ path, matchedRule: input.scenario.adapterId })),
    matchedRules: [matchedRule],
    runtimeEvidence,
    replayEvidence: input.hasReplayEvidence ? runtimeEvidence : undefined,
    verificationStatus: input.hasReplayEvidence ? "Replay reproduced" : "Not replay verified",
    recommendedFix,
    safeFixConfidence: Math.min(0.95, confidence + 0.05),
    projectType: projectContext.projectType,
  };
}

function buildRuntimeEvidenceItems(
  evidence: Pick<AttackEvidence, "redactedRequest" | "redactedResponse" | "sideEffects">,
  buffer?: EvidenceCaptureBuffer
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  if (evidence.redactedRequest) {
    items.push({
      id: "request",
      kind: "runtime_request",
      label: "Runtime request captured",
      detail: JSON.stringify(evidence.redactedRequest).slice(0, 500),
      confidence: 0.8,
    });
  }
  if (evidence.redactedResponse) {
    items.push({
      id: "response",
      kind: "runtime_response",
      label: "Runtime response captured",
      detail: JSON.stringify(evidence.redactedResponse).slice(0, 500),
      confidence: 0.8,
    });
  }
  if (buffer) {
    for (const step of buffer.steps.slice(0, 5)) {
      items.push({
        id: `step-${step.stepId}`,
        kind: "execution_step",
        label: step.stepLabel,
        detail: step.runtimeResult.observedBehavior,
        confidence: 0.7,
      });
    }
  }
  return items;
}

function buildAttackCounterEvidence(
  evaluation: AttackOutcomeEvaluation,
  runtimeMode: AttackRuntimeMode,
  context: ReturnType<typeof analyzeProjectContext>
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  if (runtimeMode === "mock") {
    items.push({
      id: "mock-runtime",
      kind: "mock_simulation",
      label: "Mock simulation only",
      detail: "Behavior was observed in mock mode, not live production traffic.",
    });
  }
  if (evaluation.protectionSignalHits > 0) {
    items.push({
      id: "protection-signals",
      kind: "protection_signal",
      label: "Protection signals present",
      detail: `${evaluation.protectionSignalHits} protection indicator(s) were also observed.`,
    });
  }
  if (context.projectType === "marketing_website") {
    items.push({
      id: "public-site",
      kind: "project_classification",
      label: "Public website classification",
      detail: context.projectType,
    });
  }
  return items;
}

export function attachEvidenceReportToMetadata(
  metadata: Record<string, unknown>,
  report: EvidenceReport
): Record<string, unknown> {
  return {
    ...metadata,
    [EVIDENCE_REPORT_METADATA_KEY]: report,
    confirmationStatus: report.confirmationStatus,
    detectionMethod: report.detectionMethod,
  };
}
