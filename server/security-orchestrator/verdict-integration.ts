import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerdictEngineInput } from "@/brain/production-verdict/engine";

type VerdictFinding = VerdictEngineInput["findings"][number];

/**
 * Phase 37, workstream C: folds external-engine findings (OpenGrep/Trivy/
 * Crypto/Scorecard -- server/security-engines/*, persisted by Phase 35's
 * persistEngineResults() into external_engine_findings) into the SAME
 * Production Verdict scoring input native findings already use
 * (brain/production-verdict/engine.ts's `findings` array) -- no second
 * score, no second verdict.
 *
 * Deduplication (brief section 8): reuses Phase 35's own
 * finding_correlations rows (kind='same_issue') rather than re-deriving
 * dedup logic here. For each correlation group, only ONE representative
 * finding is kept in the merged set -- a native finding wins when the
 * group contains one (native is already scored, so its external
 * corroboration is evidence, not an extra finding); otherwise the first
 * external finding in the group is kept and the rest of that group's
 * external findings are excluded from the merge, so a SQLi flagged by both
 * OpenGrep and Trivy-adjacent tooling never counts twice.
 *
 * Engines that were SKIPPED/FAILED/UNAVAILABLE simply never wrote a row to
 * external_engine_findings for this scan (persistEngineResults only
 * inserts real findings from COMPLETED/PARTIAL results) -- so their
 * absence here already can't be misread as "clean," matching the coverage
 * model's separate (and stricter) unavailable-tracking.
 */
export async function loadExternalEngineFindingsForVerdict(
  admin: SupabaseClient,
  input: { scanId: string; organizationId: string; nativeFindingIds: ReadonlySet<string> }
): Promise<VerdictFinding[]> {
  const [{ data: externalRows }, { data: correlationRows }] = await Promise.all([
    admin
      .from("external_engine_findings")
      .select("finding_id, title, severity, category, engine, affected_files, remediation, confidence, evidence, cwe")
      .eq("scan_id", input.scanId)
      .eq("organization_id", input.organizationId),
    admin
      .from("finding_correlations")
      .select("finding_ids, kind")
      .eq("scan_id", input.scanId)
      .eq("organization_id", input.organizationId)
      .eq("kind", "same_issue"),
  ]);

  const rows = (externalRows ?? []) as Array<{
    finding_id: string;
    title: string;
    severity: string;
    category: string;
    engine: string;
    affected_files: unknown;
    remediation: string | null;
    confidence: string;
    evidence: unknown;
    cwe: unknown;
  }>;
  if (rows.length === 0) return [];

  // Build the suppression set: ids to exclude from the merged findings
  // because a correlation group already keeps a different representative.
  const suppressed = new Set<string>();
  for (const group of (correlationRows ?? []) as Array<{ finding_ids: unknown }>) {
    const ids = Array.isArray(group.finding_ids) ? (group.finding_ids as string[]) : [];
    if (ids.length < 2) continue;
    const hasNativeRepresentative = ids.some((id) => input.nativeFindingIds.has(id));
    if (hasNativeRepresentative) {
      // Native finding already scored -- suppress every external id in this group.
      for (const id of ids) {
        if (!input.nativeFindingIds.has(id)) suppressed.add(id);
      }
      continue;
    }
    // No native representative -- keep the first external id, suppress the rest.
    for (const id of ids.slice(1)) suppressed.add(id);
  }

  return rows
    .filter((row) => !suppressed.has(row.finding_id))
    .map((row) => {
      const evidenceArray = Array.isArray(row.evidence) ? (row.evidence as unknown[]) : [];
      const evidenceText = evidenceArray
        .map((e) => (e && typeof e === "object" && "detail" in e ? String((e as { detail?: unknown }).detail ?? "") : ""))
        .filter(Boolean)
        .join(" | ");
      const affectedFiles = Array.isArray(row.affected_files) ? (row.affected_files as string[]) : [];
      return {
        id: row.finding_id,
        title: row.title,
        severity: row.severity,
        category: row.category,
        rule_id: `${row.engine}:${row.finding_id}`,
        file_path: affectedFiles[0] ?? null,
        start_line: null,
        recommendation: row.remediation,
        confidence: row.confidence,
        evidence: evidenceText || null,
        metadata: { engine: row.engine, cwe: row.cwe ?? [] },
      } satisfies VerdictFinding;
    });
}

/**
 * F10 pilot-readiness audit: a FAILED (or TIMED_OUT/REJECTED/still-in-
 * flight) external-engine security_jobs row for this scan previously had
 * NO effect on the Production Verdict's partialScanFailure flag --
 * core.ts's generateAndPersistProductionVerdict only ever looked at the
 * native scan's own `scans.status`. persistEngineResults() already never
 * writes a finding row for a failed engine (this file's own comment above:
 * "their absence here already can't be misread as clean"), but nothing
 * upstream of that ever told the VERDICT that an engine's evidence was
 * missing -- so a scan with, say, a crashed opengrep job could still
 * receive a fully "complete" verdict with opengrep's findings silently
 * absent. This existed because security_jobs was never queried anywhere in
 * server/production-verdict/* or server/jobs/* (confirmed by repo-wide
 * grep) -- not a deliberate design choice, a genuine gap. Reuses the same
 * scanId/organizationId scoping every other query in this file already
 * uses; adds no new persistence, verdict, or scoring logic.
 *
 * Returns false (no incomplete coverage) when no security_jobs rows exist
 * for this scan at all -- that means external engines were never planned
 * for this scan, which is not a failure, just a native-only scan the
 * existing flow already represents honestly.
 */
export async function hasIncompleteExternalEngineCoverage(
  admin: SupabaseClient,
  input: { scanId: string; organizationId: string }
): Promise<boolean> {
  const [jobsRes, executionsRes] = await Promise.all([
    admin
      .from("security_jobs")
      .select("id, engine, status, requested_at")
      .eq("scan_id", input.scanId)
      .eq("organization_id", input.organizationId),
    admin
      .from("engine_executions")
      .select("engine, status, created_at")
      .eq("scan_id", input.scanId)
      .eq("organization_id", input.organizationId),
  ]);

  if (jobsRes.error || executionsRes.error || !jobsRes.data || !executionsRes.data) {
    // A read failure here must never silently look like "full coverage" --
    // the safer honest default is to assume coverage MIGHT be incomplete
    // rather than assert it is complete without evidence.
    return true;
  }

  // The LATEST attempt per engine decides: a retry that genuinely completes
  // supersedes an earlier failed/partial run, and an earlier run can never
  // make a later complete one look incomplete (or the reverse).
  const latestJob = new Map<string, { status: string; at: string }>();
  for (const row of jobsRes.data as Array<Record<string, unknown>>) {
    const engine = String(row.engine);
    const at = String(row.requested_at ?? "");
    const current = latestJob.get(engine);
    if (!current || at >= current.at) latestJob.set(engine, { status: String(row.status), at });
  }

  // Evidence is complete only for COMPLETED. QUEUED, RUNNING, FAILED, TIMED_OUT,
  // CANCELLED and REJECTED are all incomplete.
  for (const job of latestJob.values()) {
    if (job.status !== "COMPLETED") return true;
  }

  // Second, independent source: the engine's own persisted result. A PARTIAL
  // (or otherwise non-COMPLETED) execution is incomplete evidence even if a job
  // row says COMPLETED -- which is how PARTIAL results used to read as complete.
  const latestExecution = new Map<string, { status: string; at: string }>();
  for (const row of executionsRes.data as Array<Record<string, unknown>>) {
    const engine = String(row.engine);
    const at = String(row.created_at ?? "");
    const current = latestExecution.get(engine);
    if (!current || at >= current.at) latestExecution.set(engine, { status: String(row.status), at });
  }
  for (const [engine, execution] of latestExecution) {
    // Only engines that had a job are external engines of this scan's plan.
    if (latestJob.has(engine) && execution.status !== "COMPLETED") return true;
  }

  return false;
}
