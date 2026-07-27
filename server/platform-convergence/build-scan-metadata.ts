import "server-only";

import type { AttackResult, RedTeamReport } from "@/server/ai-red-team/types";
import type { ScanJobPlatformMetadata, ScanRedTeamPipelineResult } from "./types";
import { buildPlatformExecutionIds } from "./types";
import { extractMissionControlInputs } from "@/server/ai-red-team/e2e-validation/traceability";
import {
  readCanonicalAttackPreconditionsFromResult,
  collectLlmReplayPlansFromResult,
} from "@/server/ai-red-team/llm-team/integration/platform-bridge";

function teamStatusFromResults(results: AttackResult[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of results) {
    if (r.agentId === "logic.business" && r.metadata?.teamExecution) {
      Object.assign(out, r.metadata.teamExecution as Record<string, string>);
    }
    if (r.agentId === "ai.llm" && r.metadata?.teamExecution) {
      Object.assign(out, r.metadata.teamExecution as Record<string, string>);
    }
  }
  return out;
}

export function buildScanJobPlatformMetadata(
  result: ScanRedTeamPipelineResult,
  report: RedTeamReport
): ScanJobPlatformMetadata {
  const mc = extractMissionControlInputs(report);
  const rt10 = report.results.find((r) => r.agentId === "ai.llm");
  const rt9 = report.results.find((r) => r.agentId === "logic.business");

  let replayPlanCount = 0;
  if (rt10) {
    replayPlanCount += collectLlmReplayPlansFromResult(rt10).length;
  }
  if (rt9?.metadata?.replayPlans && Array.isArray(rt9.metadata.replayPlans)) {
    replayPlanCount += rt9.metadata.replayPlans.length;
  }

  const ids = buildPlatformExecutionIds({
    scanId: result.ids.scanId,
    scanJobId: result.ids.scanJobId,
    decisionId: report.securityDecision?.decision.decisionId ?? null,
    verdictId: result.ids.verdictId,
  });

  return {
    version: "1.0.0",
    ids,
    pipelineStatus: result.status,
    teamExecution: { ...teamStatusFromResults(report.results), ...mc.teamExecution },
    teamRunIds: {
      rt9: (rt9?.metadata?.businessLogicTeamRunId as string | undefined) ?? null,
      rt10: (rt10?.metadata?.llmTeamRunId as string | undefined) ?? null,
    },
    businessLogicMetrics: mc.businessLogicMetrics ?? undefined,
    llmMetrics: mc.llmMetrics ?? undefined,
    protectedAssetsSummary: rt10?.metadata?.protectedAssetSummary,
    attackPreconditionsSummary: rt10 ? readCanonicalAttackPreconditionsFromResult(rt10) : undefined,
    coverage: {
      rt9:
        typeof (rt9?.metadata?.businessLogicPlatform as { coverage?: { coveragePercent?: number } })
          ?.coverage?.coveragePercent === "number"
          ? (rt9!.metadata!.businessLogicPlatform as { coverage: { coveragePercent: number } }).coverage
              .coveragePercent
          : undefined,
      rt10:
        typeof (rt10?.metadata?.llmPlatform as { coverage?: { coveragePercent?: number } })?.coverage
          ?.coveragePercent === "number"
          ? (rt10!.metadata!.llmPlatform as { coverage: { coveragePercent: number } }).coverage
              .coveragePercent
          : undefined,
    },
    replayPlanCount,
    missionControlPayload: {
      businessLogic: rt9?.metadata?.businessLogicPlatform,
      llm: rt10?.metadata?.llmPlatform,
    },
    intelligenceReportId: report.intelligence?.reportId,
    intelligenceSummary: report.intelligence
      ? {
          reportId: report.intelligence.reportId,
          correlationCount: report.intelligence.correlations.length,
          verdictStatus: report.intelligence.verdict?.status ?? null,
        }
      : undefined,
    errorMessage: result.errorMessage ?? undefined,
    completedAt: new Date().toISOString(),
  };
}

/** Flatten platform block into scan_jobs.metadata keys expected by MC parsers. */
export function flattenPlatformMetadataForScanJob(
  platform: ScanJobPlatformMetadata
): Record<string, unknown> {
  return {
    platform,
    platformConvergence: platform,
    correlationId: platform.ids.correlationId,
    executionId: platform.ids.executionId,
    scanId: platform.ids.scanId,
    decisionId: platform.ids.decisionId,
    teamExecution: platform.teamExecution,
    businessLogicMetrics: platform.businessLogicMetrics,
    llmMetrics: platform.llmMetrics,
    businessLogicTeamResult: platform.teamExecution.business_logic
      ? { status: platform.teamExecution.business_logic }
      : undefined,
    llmTeamResult: platform.teamExecution.llm ? { status: platform.teamExecution.llm } : undefined,
  };
}
