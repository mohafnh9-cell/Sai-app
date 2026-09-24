import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineResult } from "@/server/security-engines/types";
import { mapScanFindingRowToSequrAIFinding } from "@/server/security-engines/persistence";
import { hasIncompleteNativeRuleCoverage } from "@/server/security-scanner/native-coverage";

/**
 * Phase 38, section 10: "native" has no SecurityJob/SecurityEngine wrapper --
 * it runs on its own pre-existing pipeline stage (server/security-scanner/
 * scan-job-runner.ts), strictly BEFORE executeUnifiedScanRedTeamPhase (and
 * therefore this orchestrator) ever runs for the same scanId. Its findings
 * are therefore already persisted to scan_findings by the time this is
 * called -- the fix is to read that one source of truth into a synthetic
 * EngineResult for coverage purposes, never to execute native a second time
 * or maintain a second finding-mapping (reuses persistence.ts's own mapper).
 */
export async function loadNativeEngineResult(
  admin: SupabaseClient,
  ctx: { scanId: string; projectId: string; organizationId: string }
): Promise<EngineResult> {
  const now = new Date().toISOString();
  const base = {
    engine: "native" as const,
    engineVersion: "native-47-rule",
    executionId: `native:${ctx.scanId}`,
    scanId: ctx.scanId,
    projectId: ctx.projectId,
    organizationId: ctx.organizationId,
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    capabilitiesAttempted: [],
    capabilitiesCompleted: [],
    evidence: [],
  };

  const { data: rows, error } = await admin
    .from("scan_findings")
    .select("id, title, description, severity, category, file_path, start_line, recommendation, confidence, metadata")
    .eq("scan_id", ctx.scanId);

  if (error) {
    return {
      ...base,
      status: "FAILED",
      findings: [],
      metrics: {},
      errors: [{ code: "NATIVE_COVERAGE_QUERY_FAILED", message: error.message }],
    };
  }

  const findings = (rows ?? []).map((row) => mapScanFindingRowToSequrAIFinding(row as Record<string, unknown>, ctx));

  // A native rule that threw or never ran (time budget) is missing evidence:
  // the native engine is PARTIAL, never "completed clean".
  const { data: scanRow, error: scanError } = await admin
    .from("scans")
    .select("metrics, omissions")
    .eq("id", ctx.scanId)
    .maybeSingle();
  if (scanError || !scanRow) {
    return {
      ...base,
      status: "FAILED",
      findings,
      metrics: { findingsCount: findings.length },
      errors: [
        {
          code: "NATIVE_SCAN_RECORD_UNAVAILABLE",
          message: scanError?.message ?? "native scan record not found",
        },
      ],
    };
  }
  if (hasIncompleteNativeRuleCoverage({ metrics: scanRow.metrics, omissions: scanRow.omissions })) {
    return {
      ...base,
      status: "PARTIAL",
      findings,
      evidence: findings.flatMap((f) => f.evidence),
      metrics: { findingsCount: findings.length },
      errors: [{ code: "NATIVE_RULES_INCOMPLETE", message: "one or more native rules failed or did not run" }],
    };
  }

  return {
    ...base,
    status: "COMPLETED",
    findings,
    evidence: findings.flatMap((f) => f.evidence),
    metrics: { findingsCount: findings.length },
    errors: [],
  };
}
