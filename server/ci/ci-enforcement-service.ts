import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import {
  parseGitHubRepository,
  resolveCommitReference,
  GitHubServiceError,
} from "@/lib/github/repository-service";
import {
  SEQURAI_CHECK_RUN_NAME,
  verdictStatusToCheckConclusion,
} from "@/server/github-automation/github-check-run";
import { resolveOrganizationGitHubToken } from "@/server/github-automation/token-resolver";
import { getProductionVerdictByScan } from "@/server/production-verdict/service";
import {
  getLatestPullRequestScan,
  isPullRequestVerdictStale,
} from "@/server/pull-request/get-pr-verdict";
import { scheduleScanRun } from "@/server/jobs/schedule-scan";
import { ScanEnqueueError } from "@/server/jobs/scan-execution/enqueue-scan-run";
import { ScanJobInfrastructureError } from "@/server/jobs/scan-job-infrastructure";
import { mapDatabaseError } from "@/server/security-scanner/admin-client";
import { ScanRequestError } from "@/server/security-scanner/request-context";
import { assertOrganizationCanRunScan } from "@/server/billing/assert-scan-access";
import { releaseActiveReviewForNewHead } from "@/server/review-start/release-active-review-for-new-head";
import { findScanByCommitSha } from "./find-scan-by-sha";
import { buildCiIdempotencyKey } from "./idempotency-key";
import { logCiEvent } from "./observability";
import type { CiEnforcementStatus, CiEnsureScanResult, CiScanPhase } from "./types";
import { normalizeCommitSha } from "./validate-sha";
import type { CiProjectAccess } from "./ci-access";

const ACTIVE_SCAN_STATUSES = new Set([
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
  "cancelling",
]);

function scanStatusToPhase(status: string | null | undefined): CiScanPhase {
  if (!status) return "missing";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (ACTIVE_SCAN_STATUSES.has(status)) return status === "queued" ? "queued" : "running";
  return "missing";
}

function buildCheckRunView(input: {
  verdict: ProductionVerdictV1 | null;
  scanPhase: CiScanPhase;
  checkStatus?: "passed" | "failed" | "warning" | "pending" | null;
  githubCheckRunId?: number | null;
  /** When true, never surface a historical verdict as success for the current PR head. */
  stale?: boolean;
}): CiEnforcementStatus["checkRun"] {
  if (input.stale) {
    return {
      name: SEQURAI_CHECK_RUN_NAME,
      conclusion: "neutral",
      githubCheckRunId: input.githubCheckRunId ?? null,
    };
  }

  const scanMissing = input.scanPhase === "missing" || input.scanPhase === "failed";
  const pending = input.scanPhase === "queued" || input.scanPhase === "running";
  return {
    name: SEQURAI_CHECK_RUN_NAME,
    conclusion: verdictStatusToCheckConclusion(input.verdict?.status, {
      checkStatus: pending ? "pending" : input.checkStatus ?? null,
      scanMissing,
    }),
    githubCheckRunId: input.githubCheckRunId ?? null,
  } satisfies CiEnforcementStatus["checkRun"];
}

export type GetCiEnforcementStatusInput = {
  projectId: string;
  organizationId: string;
  commitSha: string;
  prNumber?: number | null;
  baseSha?: string | null;
  headSha?: string | null;
};

export async function getCiEnforcementStatus(
  admin: SupabaseClient,
  input: GetCiEnforcementStatusInput
): Promise<CiEnforcementStatus> {
  const commitSha = normalizeCommitSha(input.commitSha);
  const prNumber = input.prNumber ?? null;
  const headSha = input.headSha ? normalizeCommitSha(input.headSha) : commitSha;
  const baseSha = input.baseSha?.trim() ? normalizeCommitSha(input.baseSha) : null;

  let scanId: string | null = null;
  let scanPhase: CiScanPhase = "missing";
  let source: CiEnforcementStatus["source"] = null;
  let productionVerdict: ProductionVerdictV1 | null = null;
  let checkStatus: "passed" | "failed" | "warning" | "pending" | null = null;
  let githubCheckRunId: number | null = null;
  let stale = false;

  if (prNumber != null) {
    const prScan = await getLatestPullRequestScan(admin, {
      projectId: input.projectId,
      pullRequestNumber: prNumber,
      headSha,
    });
    stale = await isPullRequestVerdictStale(admin, {
      projectId: input.projectId,
      pullRequestNumber: prNumber,
      currentHeadSha: headSha,
    });
    if (prScan) {
      scanId = prScan.scanId;
      scanPhase =
        prScan.scanStatus === "completed"
          ? "completed"
          : prScan.scanStatus === "pending"
            ? "running"
            : "missing";
      source = "pr";
      productionVerdict = prScan.productionVerdict;
      checkStatus = prScan.checkStatus;
      githubCheckRunId = prScan.githubCheckRunId;
    }
  }

  if (!scanId) {
    const bySha = await findScanByCommitSha(admin, {
      projectId: input.projectId,
      commitSha,
    });
    if (bySha.state !== "none") {
      scanId = String(bySha.scan.id);
      scanPhase = scanStatusToPhase(String(bySha.scan.status));
      source = "github";
      if (bySha.state === "completed") {
        productionVerdict = await getProductionVerdictByScan(admin, input.organizationId, scanId);
      }
    }
  }

  const correlationReady = scanPhase === "completed" && productionVerdict != null && !stale;

  return {
    ok: !stale && scanPhase === "completed" && productionVerdict != null,
    projectId: input.projectId,
    organizationId: input.organizationId,
    commitSha,
    prNumber,
    baseSha,
    headSha,
    scanId,
    scanPhase,
    source,
    stale,
    productionVerdict,
    checkRun: buildCheckRunView({
      verdict: productionVerdict,
      scanPhase,
      checkStatus,
      githubCheckRunId,
      stale,
    }),
    correlation: {
      ready: correlationReady,
      endpoint: `/api/projects/${input.projectId}/local-correlation`,
    },
    idempotencyKey: buildCiIdempotencyKey({
      projectId: input.projectId,
      commitSha,
      prNumber,
    }),
    triggerSource: "ci",
  };
}

export type EnsureCiScanInput = {
  commitSha: string;
  prNumber?: number | null;
  baseSha?: string | null;
  headSha?: string | null;
  forceNew?: boolean;
};

export async function ensureCiScan(
  access: CiProjectAccess,
  input: EnsureCiScanInput
): Promise<CiEnsureScanResult> {
  const commitSha = normalizeCommitSha(input.commitSha);
  const prNumber = input.prNumber ?? null;
  const headSha = input.headSha ? normalizeCommitSha(input.headSha) : commitSha;

  if (prNumber != null && !commitsMatch(headSha, commitSha)) {
    return {
      outcome: "failed",
      code: "PR_SHA_MISMATCH",
      message: "headSha must match commitSha for pull request CI requests",
    };
  }

  logCiEvent("ci_scan_requested", {
    organizationId: access.project.organization_id,
    projectId: access.project.id,
    commitSha,
    prNumber,
    authSource: access.authSource,
  });

  if (!access.project.github_repo) {
    return {
      outcome: "failed",
      code: "GITHUB_REPOSITORY_REQUIRED",
      message: "Project has no connected GitHub repository",
    };
  }

  const githubRepo = parseGitHubRepository(access.project.github_repo);
  const tokenResult = await resolveOrganizationGitHubToken(
    access.admin,
    access.project.organization_id,
    access.project.id
  );
  if (!tokenResult) {
    return {
      outcome: "failed",
      code: "GITHUB_TOKEN_UNAVAILABLE",
      message: "GitHub credentials are not available for this project",
    };
  }

  let resolvedSha: string;
  let resolvedBranch: string | null = null;
  try {
    const resolved = await resolveCommitReference(tokenResult.token, githubRepo, {
      commitSha,
    });
    resolvedSha = resolved.sha;
    resolvedBranch = resolved.branch;
  } catch (error) {
    if (error instanceof GitHubServiceError) {
      return {
        outcome: "failed",
        code: error.code,
        message: error.message,
      };
    }
    throw error;
  }

  const statusInput = {
    projectId: access.project.id,
    organizationId: access.project.organization_id,
    commitSha: resolvedSha,
    prNumber,
    baseSha: input.baseSha ?? null,
    headSha,
  };

  if (prNumber != null) {
    const status = await getCiEnforcementStatus(access.admin, statusInput);
    if (status.scanPhase === "missing") {
      logCiEvent("ci_pr_awaiting_webhook", {
        organizationId: access.project.organization_id,
        projectId: access.project.id,
        commitSha: resolvedSha,
        prNumber,
      });
      return {
        outcome: "awaiting_webhook",
        status,
        message:
          "Pull request scans are triggered by the GitHub webhook. SequrAI is waiting for the existing PR pipeline.",
      };
    }
    return {
      outcome: status.scanPhase === "completed" ? "reused" : "resumed",
      status,
      message:
        status.scanPhase === "completed"
          ? "Production Verdict already available for this PR commit."
          : "Pull request scan already in progress for this commit.",
    };
  }

  if (!input.forceNew) {
    const existing = await findScanByCommitSha(access.admin, {
      projectId: access.project.id,
      commitSha: resolvedSha,
    });
    if (existing.state === "active") {
      const status = await getCiEnforcementStatus(access.admin, statusInput);
      return {
        outcome: "resumed",
        status,
        message: "Scan already in progress for this commit.",
      };
    }
    if (existing.state === "completed") {
      const status = await getCiEnforcementStatus(access.admin, statusInput);
      return {
        outcome: "reused",
        status,
        message: "Production Verdict already available for this commit.",
      };
    }
  }

  await assertOrganizationCanRunScan(access.admin, access.project.organization_id, {
    id: access.userId,
  });

  await releaseActiveReviewForNewHead(access.admin, {
    organizationId: access.project.organization_id,
    projectId: access.project.id,
    targetCommitSha: resolvedSha,
    targetBranch: resolvedBranch ?? undefined,
  });

  const correlationId = randomUUID();
  const scanInsertPayload = {
    organization_id: access.project.organization_id,
    project_id: access.project.id,
    repository_id: access.project.id,
    triggered_by_user_id: access.userId,
    trigger_type: "manual" as const,
    review_type: "manual" as const,
    scan_type: "full" as const,
    status: "queued",
    progress: 0,
    progress_message: "ciQueued",
    branch: resolvedBranch,
    commit_sha: resolvedSha,
  };

  const { data: scan, error: insertError } = await access.admin
    .from("scans")
    .insert(scanInsertPayload)
    .select("*")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const status = await getCiEnforcementStatus(access.admin, statusInput);
      return {
        outcome: status.scanPhase === "completed" ? "reused" : "resumed",
        status,
        message: "Concurrent CI request resolved to the existing scan for this commit.",
      };
    }
    throw mapDatabaseError(insertError, "Could not create CI scan");
  }

  await access.admin.from("repository_scan_state").upsert(
    {
      repository_id: access.project.id,
      organization_id: access.project.organization_id,
      active_scan_id: scan.id,
    },
    { onConflict: "repository_id" }
  );

  try {
    const scheduled = await scheduleScanRun(
      access.admin,
      {
        scanJobId: "",
        scanId: scan.id,
        organizationId: access.project.organization_id,
        projectId: access.project.id,
        userId: access.userId,
        branch: resolvedBranch ?? undefined,
        headCommitSha: resolvedSha,
        scanType: "full",
        jobType: "manual_scan",
        correlationId,
      },
      { awaitInlineExecution: false }
    );

    logCiEvent("ci_scan_scheduled", {
      organizationId: access.project.organization_id,
      projectId: access.project.id,
      commitSha: resolvedSha,
      scanId: scan.id,
      authSource: tokenResult.authSource ?? null,
      outcome: scheduled.duplicate ? "duplicate_job" : "scheduled",
    });

    const status = await getCiEnforcementStatus(access.admin, statusInput);
    return {
      outcome: "scheduled",
      status,
      message: scheduled.duplicate
        ? "Scan job already queued for this commit."
        : "CI scan scheduled. Poll GET /ci/status until the Production Verdict is ready.",
    };
  } catch (error) {
    await access.admin
      .from("scans")
      .update({
        status: "failed",
        error_code: error instanceof ScanEnqueueError ? error.code : "CI_SCAN_SCHEDULE_FAILED",
        error_message: error instanceof Error ? error.message : "Could not schedule CI scan",
        failed_at: new Date().toISOString(),
      })
      .eq("id", scan.id);

    if (error instanceof ScanJobInfrastructureError || error instanceof ScanEnqueueError) {
      return {
        outcome: "failed",
        code: error instanceof ScanEnqueueError ? error.code : "SCAN_INFRASTRUCTURE_UNAVAILABLE",
        message: error.message,
      };
    }
    if (error instanceof ScanRequestError) {
      return { outcome: "failed", code: error.code, message: error.message };
    }
    throw error;
  }
}

function commitsMatch(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}
