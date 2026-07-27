import "server-only";

import { createDefaultRedTeamEngine } from "@/server/ai-red-team";
import type { DiscoveryRepositoryInput } from "@/server/ai-red-team/discovery/types";
import type { ScanRedTeamPipelineResult } from "./types";
import { buildPlatformExecutionIds } from "./types";

const MAX_RED_TEAM_FILES = 200;
const MAX_FILE_BYTES = 256_000;

function toDiscoveryRepository(input: {
  projectId: string;
  organizationId: string;
  commitSha: string;
  files: Array<{ path: string; content: string }>;
}): DiscoveryRepositoryInput {
  const files = input.files
    .filter((f) => f.content.length <= MAX_FILE_BYTES)
    .slice(0, MAX_RED_TEAM_FILES)
    .map((f) => ({ path: f.path, content: f.content }));
  return {
    projectId: input.projectId,
    organizationId: input.organizationId,
    commitSha: input.commitSha,
    files,
  };
}

/**
 * Unified red-team execution for product scans — Security Director is the sole orchestrator.
 */
export async function runScanRedTeamPipeline(input: {
  scanId: string;
  scanJobId: string;
  organizationId: string;
  projectId: string;
  commitSha: string;
  files: Array<{ path: string; content: string }>;
}): Promise<ScanRedTeamPipelineResult> {
  const started = Date.now();
  const baseIds = buildPlatformExecutionIds({
    scanId: input.scanId,
    scanJobId: input.scanJobId,
  });

  if (input.files.length === 0) {
    return {
      status: "skipped",
      ids: baseIds,
      report: null,
      securityDecision: null,
      errorMessage: "No files available for red-team discovery.",
      durationMs: Date.now() - started,
    };
  }

  try {
    if (
      process.env.ALLOW_PLATFORM_CONVERGENCE_FAULT_INJECTION === "1" &&
      process.env.PLATFORM_CONVERGENCE_CERT_INJECT_FAULT
    ) {
      throw new Error(
        `Certification fault injection: ${process.env.PLATFORM_CONVERGENCE_CERT_INJECT_FAULT}`
      );
    }

    const { director } = createDefaultRedTeamEngine();
    const report = await director.run({
      requestId: baseIds.directorRequestId,
      directorPipeline: true,
      context: {
        projectId: input.projectId,
        organizationId: input.organizationId,
        metadata: {
          scanId: input.scanId,
          scanJobId: input.scanJobId,
          correlationId: baseIds.correlationId,
          executionId: baseIds.executionId,
        },
      },
      discoveryRepository: toDiscoveryRepository(input),
      decisionContext: {
        commitSha: input.commitSha,
        replayStatus: "not_run",
        redTeamRunStatus: "completed",
      },
    });

    const decisionId = report.securityDecision?.decision.decisionId ?? null;
    const failedTeams = report.results.filter(
      (r) => (r.agentId === "logic.business" || r.agentId === "ai.llm") && r.status === "failed"
    );
    const status =
      failedTeams.length === 0
        ? "completed"
        : failedTeams.length < report.results.length
          ? "partial"
          : "failed";

    return {
      status,
      ids: buildPlatformExecutionIds({
        scanId: input.scanId,
        scanJobId: input.scanJobId,
        decisionId,
      }),
      report,
      securityDecision: report.securityDecision ?? null,
      errorMessage: null,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      ids: baseIds,
      report: null,
      securityDecision: null,
      errorMessage: message,
      durationMs: Date.now() - started,
    };
  }
}
