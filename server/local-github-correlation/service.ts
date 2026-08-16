import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  correlateCommitSha,
  correlateLocalFindingsBatch,
  correlatePullRequestByHeadSha,
  githubSnapshotFromRow,
} from "@/lib/correlation/match-findings";
import type {
  LocalFindingCorrelationInput,
  LocalGitHubCorrelationSummary,
} from "@/lib/correlation/types";

type ScanRow = {
  id: string;
  commit_sha: string | null;
  status: string;
};

export async function loadProjectGitHubContext(
  admin: SupabaseClient,
  input: { projectId: string; organizationId: string }
): Promise<{
  githubRepo: string | null;
  githubRepositoryId: number | null;
}> {
  const { data } = await admin
    .from("projects")
    .select("github_repo, github_repository_id")
    .eq("id", input.projectId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  return {
    githubRepo: (data?.github_repo as string | null) ?? null,
    githubRepositoryId: (data?.github_repository_id as number | null) ?? null,
  };
}

async function loadScanForCommit(
  admin: SupabaseClient,
  input: { projectId: string; organizationId: string; commitSha?: string | null }
): Promise<ScanRow | null> {
  if (input.commitSha?.trim()) {
    const normalized = input.commitSha.trim().toLowerCase();
    const { data } = await admin
      .from("scans")
      .select("id, commit_sha, status")
      .eq("project_id", input.projectId)
      .eq("organization_id", input.organizationId)
      .eq("status", "completed")
      .not("commit_sha", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);

    const rows = (data as ScanRow[] | null) ?? [];
    const exact = rows.find(
      (row) => row.commit_sha?.trim().toLowerCase() === normalized
    );
    if (exact) return exact;
  }

  const { data: latest } = await admin
    .from("scans")
    .select("id, commit_sha, status")
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (latest as ScanRow | null) ?? null;
}

async function loadFindingsForScan(
  admin: SupabaseClient,
  input: { scanId: string; projectId: string; organizationId: string }
) {
  const { data } = await admin
    .from("scan_findings")
    .select(
      "id, rule_id, file_path, start_line, severity, status, scan_id, metadata"
    )
    .eq("scan_id", input.scanId)
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId);

  return (data as Array<Record<string, unknown>> | null) ?? [];
}

async function loadPullRequestCandidates(
  admin: SupabaseClient,
  input: { projectId: string; organizationId: string; commitSha: string }
) {
  const normalized = input.commitSha.trim().toLowerCase();
  const { data } = await admin
    .from("pull_request_scans")
    .select("pull_request_number, head_commit_sha")
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .not("head_commit_sha", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  return ((data as Array<{ pull_request_number: number; head_commit_sha: string }> | null) ??
    []
  ).filter((row) => row.head_commit_sha.trim().toLowerCase() === normalized);
}

async function loadAuthoritativeVerdictStatus(
  admin: SupabaseClient,
  input: { projectId: string; organizationId: string }
): Promise<string | null> {
  const { data: project } = await admin
    .from("projects")
    .select("current_verdict_id")
    .eq("id", input.projectId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  const verdictId = project?.current_verdict_id as string | undefined;
  if (!verdictId) return null;

  const { data: verdict } = await admin
    .from("production_verdicts")
    .select("status")
    .eq("id", verdictId)
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  return (verdict?.status as string | null) ?? null;
}

export async function buildLocalGitHubCorrelation(input: {
  admin: SupabaseClient;
  organizationId: string;
  projectId: string;
  localCommitSha?: string | null;
  localBranch?: string | null;
  localFindings: LocalFindingCorrelationInput[];
}): Promise<LocalGitHubCorrelationSummary> {
  const project = await loadProjectGitHubContext(input.admin, {
    projectId: input.projectId,
    organizationId: input.organizationId,
  });

  const scan = await loadScanForCommit(input.admin, {
    projectId: input.projectId,
    organizationId: input.organizationId,
    commitSha: input.localCommitSha,
  });

  const githubVerdictStatus = await loadAuthoritativeVerdictStatus(input.admin, {
    projectId: input.projectId,
    organizationId: input.organizationId,
  });

  const commit: LocalGitHubCorrelationSummary["commit"] = {
    ...correlateCommitSha({
      localCommitSha: input.localCommitSha ?? null,
      githubCommitSha: scan?.commit_sha ?? null,
    }),
    localCommitSha: input.localCommitSha ?? null,
    githubCommitSha: scan?.commit_sha ?? null,
  };

  let pullRequest: LocalGitHubCorrelationSummary["pullRequest"] = {
    status: "unmatched",
    reason: "PR correlation requires a matching commit SHA.",
  };

  if (commit.status === "matched" && input.localCommitSha) {
    const prCandidates = await loadPullRequestCandidates(input.admin, {
      projectId: input.projectId,
      organizationId: input.organizationId,
      commitSha: input.localCommitSha,
    });
    const pr = correlatePullRequestByHeadSha({
      commitSha: input.localCommitSha,
      candidates: prCandidates.map((row) => ({
        pullRequestNumber: row.pull_request_number,
        headCommitSha: row.head_commit_sha,
      })),
    });
    pullRequest = {
      status: pr.status,
      pullRequestNumber: pr.pullRequestNumber,
      headCommitSha: pr.status === "matched" ? input.localCommitSha : undefined,
      reason: pr.reason,
    };
  }

  if (!scan) {
    return {
      source: "local",
      githubAuthoritative: true,
      projectId: input.projectId,
      organizationId: input.organizationId,
      githubRepo: project.githubRepo,
      commit,
      pullRequest,
      githubVerdictStatus,
      findings: input.localFindings.map((local) => ({
        status: "unmatched" as const,
        correlationKey: local.correlationKey ?? `${local.ruleId}:${local.filePath}`,
        local: {
          ruleId: local.ruleId,
          filePath: local.filePath,
          line: local.line ?? null,
          severity: local.severity,
          title: local.title ?? null,
        },
        reason: "No completed GitHub scan is available for this project.",
      })),
    };
  }

  const rows = await loadFindingsForScan(input.admin, {
    scanId: scan.id,
    projectId: input.projectId,
    organizationId: input.organizationId,
  });

  const snapshots = rows.map((row) =>
    githubSnapshotFromRow({
      id: String(row.id),
      rule_id: String(row.rule_id),
      file_path: String(row.file_path),
      start_line: Number(row.start_line),
      severity: String(row.severity),
      status: String(row.status),
      scan_id: String(row.scan_id),
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      commit_sha: scan.commit_sha,
    })
  );

  const githubOpen = snapshots.filter((s) => s.status === "open");
  const githubHistorical = snapshots.filter((s) => s.status !== "open");

  const findings = correlateLocalFindingsBatch({
    localFindings: input.localFindings,
    githubOpen,
    githubHistorical,
  });

  return {
    source: "local",
    githubAuthoritative: true,
    projectId: input.projectId,
    organizationId: input.organizationId,
    githubRepo: project.githubRepo,
    commit,
    pullRequest,
    githubVerdictStatus,
    findings,
  };
}
