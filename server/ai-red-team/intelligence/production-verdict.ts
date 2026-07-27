import type {
  AttackChain,
  BusinessImpactAssessment,
  ConfidenceBand,
  FindingConfidence,
  IntelligenceProductionVerdict,
  IntelligenceProductionVerdictStatus,
  NormalizedObservation,
  PrioritizedRemediation,
} from "./models";
import { aggregateRiskScore } from "./business-impact";
import { aggregateConfidence } from "./confidence-engine";

function mapStatus(input: {
  observations: NormalizedObservation[];
  priorities: PrioritizedRemediation[];
  riskScore: number;
  topChain: AttackChain | null;
}): IntelligenceProductionVerdictStatus {
  if (input.observations.length === 0) return "UNKNOWN";
  const blockers = input.priorities.filter(
    (p) => p.priority === "fix_immediately" || p.priority === "fix_before_production"
  );
  const highFindings = input.observations.filter((o) => o.severity === "high" || o.severity === "critical");
  if (blockers.length > 0 || highFindings.length > 0 || (input.topChain && input.topChain.severity === "critical")) {
    return "DO_NOT_DEPLOY";
  }
  if (input.priorities.some((p) => p.priority === "fix_this_sprint") || input.riskScore >= 4) {
    return "DEPLOY_WITH_MINOR_IMPROVEMENTS";
  }
  if (input.observations.every((o) => o.severity === "info" || o.severity === "low")) {
    return "SAFE_TO_DEPLOY";
  }
  return "DEPLOY_WITH_MINOR_IMPROVEMENTS";
}

export function buildIntelligenceProductionVerdict(input: {
  observations: NormalizedObservation[];
  priorities: PrioritizedRemediation[];
  impacts: BusinessImpactAssessment[];
  confidences: FindingConfidence[];
  chains: AttackChain[];
  coverage: string[];
}): IntelligenceProductionVerdict {
  const riskScore = aggregateRiskScore(input.impacts);
  const topChain = input.chains[0] ?? null;
  const status = mapStatus({
    observations: input.observations,
    priorities: input.priorities,
    riskScore,
    topChain,
  });

  const topPriorities = input.priorities.slice(0, 3);
  const topRiskFindings = input.observations
    .filter((o) => input.priorities.find((p) => p.findingId === o.id)?.priority !== "accepted_risk")
    .sort((a, b) => {
      const pa = input.priorities.find((p) => p.findingId === a.id)?.score ?? 0;
      const pb = input.priorities.find((p) => p.findingId === b.id)?.score ?? 0;
      return pb - pa;
    })
    .slice(0, 3);

  const confidence: ConfidenceBand = aggregateConfidence(input.confidences);

  const summaryByStatus: Record<IntelligenceProductionVerdictStatus, string> = {
    SAFE_TO_DEPLOY: "No material red-team blockers were correlated for this run.",
    DEPLOY_WITH_MINOR_IMPROVEMENTS: "You can ship with caution after addressing ranked improvements.",
    DO_NOT_DEPLOY: "Correlated risks include issues that should be resolved before real users are exposed.",
    UNKNOWN: "Not enough signal to recommend deployment from red-team observations alone.",
  };

  return {
    status,
    summary: summaryByStatus[status],
    businessExplanation: topRiskFindings[0]
      ? input.impacts.find((i) => i.findingId === topRiskFindings[0]?.id)?.headline ??
        "Review the highest-priority risk in business terms before launch."
      : "No significant business-impacting chain was inferred from this run.",
    technicalExplanation: topChain
      ? topChain.summary
      : topRiskFindings.map((f) => f.title).join("; ") || "No correlated attack chain detected.",
    topRisks: topRiskFindings.map((f) => f.title),
    topFixes: topPriorities.map((p) => {
      const finding = input.observations.find((o) => o.id === p.findingId);
      return finding ? `${finding.title} (${p.priority})` : p.priority;
    }),
    confidence,
    coverage: input.coverage,
    generatedAt: new Date().toISOString(),
  };
}
