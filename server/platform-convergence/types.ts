import "server-only";

import type { SecurityDecisionReport } from "@/server/ai-red-team/decision/decision-model";
import type { RedTeamReport } from "@/server/ai-red-team/types";

/** Canonical IDs for a unified scan → red-team execution (single correlation model). */
export type PlatformExecutionIds = {
  scanId: string;
  scanJobId: string;
  /** Primary trace id — equals scanId for product scans. */
  correlationId: string;
  /** Orchestrator execution anchor — scan job id. */
  executionId: string;
  directorRequestId: string;
  decisionId: string | null;
  verdictId: string | null;
};

export type ScanRedTeamPipelineStatus = "completed" | "partial" | "failed" | "skipped";

export type ScanRedTeamPipelineResult = {
  status: ScanRedTeamPipelineStatus;
  ids: PlatformExecutionIds;
  report: RedTeamReport | null;
  securityDecision: SecurityDecisionReport | null;
  errorMessage: string | null;
  durationMs: number;
};

/** Persisted scan_jobs.metadata.platform (Mission Control reads this). */
export type ScanJobPlatformMetadata = {
  version: "1.0.0";
  ids: PlatformExecutionIds;
  pipelineStatus: ScanRedTeamPipelineStatus;
  teamExecution: Record<string, string>;
  businessLogicMetrics?: unknown;
  llmMetrics?: unknown;
  protectedAssetsSummary?: unknown;
  attackPreconditionsSummary?: unknown;
  coverage?: { rt9?: number; rt10?: number };
  replayPlanCount?: number;
  missionControlPayload?: {
    businessLogic?: unknown;
    llm?: unknown;
  };
  intelligenceReportId?: string;
  intelligenceSummary?: {
    reportId: string;
    correlationCount: number;
    verdictStatus: string | null;
  };
  teamRunIds?: {
    rt9?: string | null;
    rt10?: string | null;
  };
  errorMessage?: string;
  completedAt: string;
};

export function buildPlatformExecutionIds(input: {
  scanId: string;
  scanJobId: string;
  decisionId?: string | null;
  verdictId?: string | null;
}): PlatformExecutionIds {
  return {
    scanId: input.scanId,
    scanJobId: input.scanJobId,
    correlationId: input.scanId,
    executionId: input.scanJobId,
    directorRequestId: input.scanId,
    decisionId: input.decisionId ?? null,
    verdictId: input.verdictId ?? null,
  };
}
