import { randomUUID } from "node:crypto";
import type { DecisionEngineInput, SecurityDecisionReport } from "./decision-model";
import {
  DECISION_POLICY_VERSION,
  mapDecisionToDeploymentVerdict,
} from "./decision-model";
import type { DecisionPolicyRegistry } from "./policy-registry";
import { createDefaultPolicyRegistry } from "./policy-registry";
import { evaluateCoverage } from "./coverage-engine";
import { applyAcceptedRisks } from "./risk-acceptance";
import { evaluateDeploymentGate } from "./deployment-gate";
import { scoreDecisionConfidence } from "./confidence-engine";
import {
  buildPrimaryRecommendation,
  buildRequiredActions,
} from "./recommendation-engine";
import { explainSecurityDecision } from "./decision-explainer";
import { recordDecisionHistory, globalDecisionHistoryStore } from "./decision-history";
import { DEFAULT_MIN_COVERAGE_SCORE } from "./decision-context";
import { mapDeploymentVerdictToScanStatus } from "./production-verdict-bridge";

export class SecurityDecisionEngine {
  constructor(private readonly policies: DecisionPolicyRegistry = createDefaultPolicyRegistry()) {}

  decide(input: DecisionEngineInput): SecurityDecisionReport {
    const coverage = evaluateCoverage({
      intelligence: input.intelligence,
      context: input.context,
    });

    const riskAcceptance = applyAcceptedRisks({
      intelligence: input.intelligence,
      acceptedRisks: input.context.acceptedRisks,
    });

    const policyResults = this.policies.list().map((policy) =>
      policy.evaluate({ intelligence: input.intelligence, context: input.context })
    );

    const gate = evaluateDeploymentGate({
      policyResults,
      coverage,
      riskAcceptance,
      hasFindings: input.intelligence.deduplicatedFindings.length > 0,
      minCoverageScore: input.context.minCoverageScore ?? DEFAULT_MIN_COVERAGE_SCORE,
    });

    const deploymentVerdict = mapDecisionToDeploymentVerdict(gate.decision);
    const confidence = scoreDecisionConfidence({
      intelligence: input.intelligence,
      context: input.context,
      coverage,
    });

    const recommendation = buildPrimaryRecommendation({
      decision: gate.decision,
      intelligence: input.intelligence,
      coverage,
    });

    const businessReasoning =
      input.intelligence.businessImpacts[0]?.headline ??
      input.intelligence.explanation.headline ??
      "Review correlated risks before exposing real users.";

    const decision = {
      decisionId: randomUUID(),
      decision: gate.decision,
      deploymentVerdict,
      summary: summarizeDecision(deploymentVerdict),
      technicalReasoning: gate.rationale.join(" "),
      businessReasoning,
      evidenceUsed: gate.evidenceUsed,
      evidenceMissing: [...gate.evidenceMissing, ...coverage.gaps],
      confidence,
      requiredActions: buildRequiredActions(recommendation),
      primaryRecommendation: recommendation.label,
      policiesTriggered: gate.policiesTriggered,
      policyVersion: DECISION_POLICY_VERSION,
      generatedAt: new Date().toISOString(),
    };

    const explanation = explainSecurityDecision({
      decision,
      intelligence: input.intelligence,
      coverage,
      gate,
    });

    const previous = globalDecisionHistoryStore.latest(input.context.projectId);
    const historyEntry = recordDecisionHistory({
      projectId: input.context.projectId,
      commitSha: input.context.commitSha,
      decision: gate.decision,
      deploymentVerdict,
      confidence,
      previousDecision: previous?.decision ?? input.context.previousDecision ?? null,
      previousDeploymentVerdict: previous?.deploymentVerdict ?? null,
      reasonSummary: decision.summary,
    });
    globalDecisionHistoryStore.append(historyEntry);

    const report: SecurityDecisionReport = {
      decision,
      explanation,
      coverageScore: coverage.score,
      coverageGaps: coverage.gaps,
      historyEntry,
    };

    report.decision.metadata = {
      suggestedScanVerdictStatus: mapDeploymentVerdictToScanStatus(deploymentVerdict),
      ...(input.intelligence.businessLogic?.decisionExposure
        ? { businessLogicDecisionExposure: input.intelligence.businessLogic.decisionExposure }
        : {}),
      ...(input.intelligence.llm?.decisionExposure
        ? { llmDecisionExposure: input.intelligence.llm.decisionExposure }
        : {}),
    };

    return report;
  }
}

function summarizeDecision(status: import("./decision-model").SecurityDeploymentVerdictStatus): string {
  switch (status) {
    case "SAFE_TO_DEPLOY":
      return "Safe to deploy based on current authorized security evidence.";
    case "DEPLOY_WITH_WARNINGS":
      return "Deploy with warnings — address ranked improvements soon.";
    case "DO_NOT_DEPLOY":
      return "Do not deploy — blockers or failed gates require resolution.";
    case "INSUFFICIENT_EVIDENCE":
      return "Insufficient evidence — complete verification or attack simulation first.";
  }
}

export function createSecurityDecisionEngine(
  policies?: DecisionPolicyRegistry
): SecurityDecisionEngine {
  return new SecurityDecisionEngine(policies);
}
