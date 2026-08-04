import "server-only";

import type { StartRepositoryManualScanResult } from "@/server/security-scanner/start-repository-manual-scan";
import { withAnalysisRunQuery } from "@/features/analysis-runs/lib/build-run-query";

export function mapStartScanResultToHttpBody(result: StartRepositoryManualScanResult) {
  switch (result.outcome) {
    case "reused":
      return {
        status: 200 as const,
        body: {
          scanId: result.scanId,
          scan: result.scan,
          reused: true,
          message: result.message,
        },
      };
    case "resumed":
      return {
        status: 200 as const,
        body: {
          scanId: result.scanId,
          scan: result.scan,
          resumed: true,
          message: result.message,
        },
      };
    case "in_progress":
      return {
        status: 409 as const,
        body: {
          error: "A scan is already in progress",
          code: "SCAN_IN_PROGRESS" as const,
          scan: result.scan,
        },
      };
    case "scheduled":
      return {
        status: 202 as const,
        body: {
          scanId: result.scanId,
          scanJobId: result.scanJobId,
          branch: result.branch,
          commitSha: result.commitSha,
          scan_id: result.scanId,
          scan: result.scan,
        },
      };
  }
}

export function mapStartScanResultToAnalysisRunBody(
  projectId: string,
  result: StartRepositoryManualScanResult
) {
  const mapped = mapStartScanResultToHttpBody(result);
  const runId =
    "scanId" in mapped.body && mapped.body.scanId
      ? mapped.body.scanId
      : ((mapped.body.scan as { id?: string } | null | undefined)?.id ?? null);

  return {
    status: mapped.status,
    body: {
      ok: mapped.status < 400,
      runId,
      missionControlHref: runId
        ? withAnalysisRunQuery(`/projects/${projectId}/mission-control`, runId)
        : null,
      attackCenterHref: runId
        ? withAnalysisRunQuery(`/projects/${projectId}/attack-center`, runId)
        : null,
      ...mapped.body,
    },
  };
}
