import "server-only";

import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

/** Analysis run identity — maps 1:1 to `scans.id`. */
export type AnalysisRunId = string;

export type AnalysisRunResolveSource = "query" | "active" | "latest_completed" | "none";

export type AnalysisRunResolveResult = {
  runId: AnalysisRunId | null;
  source: AnalysisRunResolveSource;
  valid: boolean;
};

export type AnalysisRunSnapshot = {
  runId: AnalysisRunId;
  projectId: string;
  organizationId: string;
  status: string;
  commitSha: string | null;
  branch: string | null;
  startedAt: string | null;
  completedAt: string | null;
  verdict: ProductionVerdictV1 | null;
};
