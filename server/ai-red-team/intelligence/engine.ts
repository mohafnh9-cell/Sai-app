import { randomUUID } from "node:crypto";
import type { AttackResult } from "../types";
import type { SecurityIntelligenceInput, SecurityIntelligenceReport } from "./models";
import { buildGraphFromRun } from "./graph-builder";
import { correlateFindings } from "./correlation-engine";
import { buildAttackChains } from "./attack-chain-builder";
import { assessBusinessImpact } from "./business-impact";
import { rankRemediationPriorities } from "./priority-engine";
import { scoreFindingConfidence } from "./confidence-engine";
import { buildIntelligenceProductionVerdict } from "./production-verdict";
import { buildFounderExplanation } from "./explanation-engine";
import { linkFindingsToMemory } from "./memory-linker";
import { groupSafeFixPlans } from "./safe-fix-grouper";
import { deduplicateObservations, normalizeObservations } from "./normalize-observations";
import { extractBusinessLogicIntelligenceFromResults } from "../business-logic/integration/platform-bridge";
import { extractLlmIntelligenceFromResults } from "../llm-team/integration/platform-bridge";

export class SecurityIntelligenceEngine {
  analyze(input: SecurityIntelligenceInput): SecurityIntelligenceReport {
    const observations = normalizeObservations(input.results);
    const deduplicated = deduplicateObservations(observations);
    const graph = buildGraphFromRun({
      discovery: input.discovery,
      results: input.results,
    });

    const correlations = correlateFindings(observations);
    const attackChains = buildAttackChains({ observations, correlations, graph });
    const businessImpacts = assessBusinessImpact(deduplicated);
    const priorities = rankRemediationPriorities({
      observations: deduplicated,
      impacts: businessImpacts,
      chains: attackChains,
    });

    const memoryLinks = linkFindingsToMemory(deduplicated, input.memory);
    const findingConfidences = deduplicated.map((obs) =>
      scoreFindingConfidence({
        observation: obs,
        discovery: input.discovery,
        staticReviewConfidence: input.staticReviewConfidence,
        historicalVerified: memoryLinks.find((m) => m.findingId === obs.id)?.previouslyFixed,
      })
    );

    const businessLogic = extractBusinessLogicIntelligenceFromResults(input.results);
    const llm = extractLlmIntelligenceFromResults(input.results);

    const coverage = [
      `Discovery confidence: ${Math.round(input.discovery.confidenceScore * 100)}%`,
      `Attack domains: ${[...new Set(input.results.map((r) => r.domain))].join(", ") || "none"}`,
      `Observations: ${observations.length} (${deduplicated.length} after deduplication)`,
      `Browser team results: ${input.results.filter((r) => r.agentId === "surface.browser").length}`,
      businessLogic
        ? `Business logic findings: ${businessLogic.findingSummary.total} (coverage ${businessLogic.coverage.coveragePercent}%)`
        : "Business logic team: not run",
      llm
        ? `AI / LLM findings: ${llm.findingSummary.total} (coverage ${llm.coverage.coveragePercent}%)`
        : "LLM team: not run",
    ];

    const verdict = buildIntelligenceProductionVerdict({
      observations: deduplicated,
      priorities,
      impacts: businessImpacts,
      confidences: findingConfidences,
      chains: attackChains,
      coverage,
    });

    const topPriority = priorities[0];
    const topBlocker = topPriority
      ? deduplicated.find((o) => o.id === topPriority.findingId)?.title ?? null
      : null;

    const explanation = buildFounderExplanation({
      observations,
      deduplicated,
      correlations,
      chains: attackChains,
      priorities,
      topBlockerTitle: topBlocker,
    });

    const groupedSafeFixPlans = groupSafeFixPlans({
      observations: deduplicated,
      chains: attackChains,
      priorities,
    });

    return {
      reportId: randomUUID(),
      generatedAt: new Date().toISOString(),
      graph,
      correlations,
      attackChains,
      businessImpacts,
      priorities,
      findingConfidences,
      verdict,
      explanation,
      memoryLinks,
      groupedSafeFixPlans,
      deduplicatedFindings: deduplicated,
      businessLogic: businessLogic ?? undefined,
      llm: llm ?? undefined,
    };
  }
}

export function createSecurityIntelligenceEngine(): SecurityIntelligenceEngine {
  return new SecurityIntelligenceEngine();
}

/** Adapter for legacy UnifiedRedTeamVerdictEngine interface. */
export function toUnifiedRedTeamVerdict(report: SecurityIntelligenceReport) {
  const statusMap = {
    SAFE_TO_DEPLOY: "accept",
    DEPLOY_WITH_MINOR_IMPROVEMENTS: "review",
    DO_NOT_DEPLOY: "block",
    UNKNOWN: "review",
  } as const;
  return {
    status: statusMap[report.verdict.status],
    headline: report.explanation.headline,
    narrative: report.verdict.businessExplanation,
    generatedAt: report.verdict.generatedAt,
    metadata: {
      intelligenceReportId: report.reportId,
      topRisks: report.verdict.topRisks,
      topFixes: report.verdict.topFixes,
      confidence: report.verdict.confidence,
    },
  };
}

export function runSecurityIntelligence(input: SecurityIntelligenceInput): SecurityIntelligenceReport {
  return createSecurityIntelligenceEngine().analyze(input);
}

export type { AttackResult };
