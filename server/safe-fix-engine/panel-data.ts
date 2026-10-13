import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PanelAnalysis, PanelData, PanelFix, PanelSuggestion, PanelVerification } from "@/features/assisted-fix/model";
import { statementFromPersisted } from "@/features/assisted-fix/model";
import { listSafeFixHistory } from "./history";
import type { SafeFixRecord } from "./types";

type Row = Record<string, unknown>;

const KNOWN_ANALYSES_LIMIT = 25;

function analysisOf(row: Row | null | undefined): PanelAnalysis | null {
  if (!row) return null;
  return {
    scanId: row.id as string,
    commitSha: (row.commit_sha as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

function titleOf(record: SafeFixRecord): string {
  const raw = record.prDraft?.prTitle ?? "";
  return raw.replace(/^\[SequrAI Safe Fix\]\s*/i, "").trim() || record.recommendationId;
}

/**
 * Everything the "Corrección asistida" section needs, read with an EXPLICIT organization + project scope (the service client
 * bypasses RLS): the project's proposals, the analysis each one was generated from, the stored verification, the latest
 * detected commit (a SUGGESTION only) and the completed analyses by commit. Reads only; nothing here is a new API.
 */
export async function loadAssistedFixPanelData(
  admin: SupabaseClient,
  scope: { organizationId: string; projectId: string }
): Promise<PanelData> {
  const records = await listSafeFixHistory(admin, scope, 30);
  const recordIds = records.map((record) => record.id);

  const verificationRows: Row[] = recordIds.length
    ? (((
        await admin
          .from("safe_fix_verifications")
          .select("id, safe_fix_id, outcome, details, created_at")
          .eq("organization_id", scope.organizationId)
          .eq("project_id", scope.projectId)
          .in("safe_fix_id", recordIds)
          .order("created_at", { ascending: false })
      ).data as Row[] | null) ?? [])
    : [];
  const latestVerification = new Map<string, Row>();
  for (const row of verificationRows) {
    const key = row.safe_fix_id as string;
    if (!latestVerification.has(key)) latestVerification.set(key, row);
  }

  const scanIds = new Set<string>();
  for (const record of records) if (record.reviewId) scanIds.add(record.reviewId);
  for (const row of latestVerification.values()) {
    const scanId = (row.details as Row | null)?.verificationScanId;
    if (typeof scanId === "string") scanIds.add(scanId);
  }
  const scanRows: Row[] = scanIds.size
    ? (((
        await admin
          .from("scans")
          .select("id, commit_sha, branch, completed_at")
          .eq("organization_id", scope.organizationId)
          .eq("project_id", scope.projectId)
          .in("id", [...scanIds])
      ).data as Row[] | null) ?? [])
    : [];
  const scanById = new Map(scanRows.map((row) => [row.id as string, row]));

  const fixes: PanelFix[] = records.map((record) => {
    const verificationRow = latestVerification.get(record.id) ?? null;
    let verification: PanelVerification | null = null;
    if (verificationRow) {
      const details = (verificationRow.details as Row | null) ?? {};
      const outcome = verificationRow.outcome as PanelVerification["outcome"];
      verification = {
        statement: statementFromPersisted({ outcome, binding: (details.binding as string | null) ?? null }),
        outcome,
        verifiedCommitSha: (details.verifiedCommitSha as string | null) ?? null,
        verifiedAnalysis:
          typeof details.verificationScanId === "string" ? analysisOf(scanById.get(details.verificationScanId) ?? null) : null,
        reasons: Array.isArray(details.reasons) ? (details.reasons as unknown[]).map(String) : [],
        verifiedAt: verificationRow.created_at as string,
        commitSha: typeof details.proposalCommitSha === "string" ? details.proposalCommitSha : null,
      };
    }
    return {
      id: record.id,
      recommendationId: record.recommendationId,
      title: titleOf(record),
      severity: null,
      state: record.lifecycleState,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      baseAnalysis: record.reviewId ? analysisOf(scanById.get(record.reviewId) ?? null) : null,
      reportedCommitSha: record.proposalCommitSha,
      instructions: record.document?.cursorPrompt ?? "",
      filesToChange: record.document?.filesToChange ?? [],
      verification,
    };
  });

  // Completed analyses by commit (newest first): lets the panel show rama/análisis for a commit the person reports.
  const knownRows =
    (((
      await admin
        .from("scans")
        .select("id, commit_sha, branch, completed_at")
        .eq("organization_id", scope.organizationId)
        .eq("project_id", scope.projectId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(KNOWN_ANALYSES_LIMIT)
    ).data as Row[] | null) ?? []);
  const knownAnalyses = knownRows.map((row) => analysisOf(row)!).filter((analysis) => Boolean(analysis.commitSha));

  // The latest detected commit is only a SUGGESTION: it is shown, never selected.
  const { data: sync } = await admin
    .from("repository_sync_status")
    .select("branch, commit_sha, detected_at")
    .eq("organization_id", scope.organizationId)
    .eq("project_id", scope.projectId)
    .maybeSingle();
  let suggestion: PanelSuggestion | null = null;
  const syncSha = (sync?.commit_sha as string | null | undefined) ?? null;
  if (syncSha) {
    suggestion = {
      branch: (sync?.branch as string | null) ?? null,
      commitSha: syncSha,
      detectedAt: (sync?.detected_at as string | null) ?? null,
      analysis: knownAnalyses.find((analysis) => analysis.commitSha?.toLowerCase() === syncSha.toLowerCase()) ?? null,
    };
  }

  return { projectId: scope.projectId, fixes, suggestion, knownAnalyses };
}
