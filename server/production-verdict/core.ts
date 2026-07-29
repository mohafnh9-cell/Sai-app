import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseProductionVerdict,
  type ProductionVerdictV1,
} from "@/brain/production-verdict/schema";
import { generateProductionVerdict as runEngine } from "@/brain/production-verdict/engine";
import { applySecurityDecisionToProductionVerdict } from "@/server/ai-red-team/decision/production-verdict-bridge";
import { emitOperationalEvent } from "@/server/observability/operational-events";
import {
  buildIdempotencyKey,
  hasCompletedSideEffect,
  recordSideEffect,
} from "@/server/observability/idempotency";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "production-verdict-service", event, ...fields });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingTableError(message: string): boolean {
  return message.includes("production_verdicts") && message.includes("does not exist");
}

export async function getLatestVerdictsByOrganization(
  client: SupabaseClient,
  organizationId: string
): Promise<Map<string, ProductionVerdictV1>> {
  const { data, error } = await client
    .from("production_verdicts")
    .select("project_id, verdict, generated_at")
    .eq("organization_id", organizationId)
    .order("generated_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error.message)) {
      log("migration_missing", { organizationId });
    } else {
      log("verdict_org_read_failed", { organizationId, error: error.message });
    }
    return new Map();
  }

  const map = new Map<string, ProductionVerdictV1>();
  for (const row of data ?? []) {
    if (!map.has(row.project_id) && row.verdict) {
      map.set(row.project_id, parseProductionVerdict(row.verdict));
    }
  }
  return map;
}

async function upsertVerdictWithRetry(
  admin: SupabaseClient,
  row: Record<string, unknown>,
  maxAttempts = 3
) {
  let lastError: { message: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await admin
      .from("production_verdicts")
      .upsert(row, { onConflict: "scan_id" })
      .select("id")
      .single();

    if (!error) {
      return { data, error: null };
    }

    lastError = error;
    if (attempt < maxAttempts) {
      await sleep(150 * attempt);
    }
  }

  return { data: null, error: lastError };
}

export async function generateAndPersistProductionVerdict(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    scanJobId?: string | null;
    /** Authoritative Security Decision from unified scan pipeline (single verdict source). */
    securityDecisionReport?: import("@/server/ai-red-team/decision/decision-model").SecurityDecisionReport | null;
    verdictRowId?: string | null;
  }
): Promise<ProductionVerdictV1 | null> {
  log("verdict_generation_started", { scanId: input.scanId, projectId: input.projectId });

  const { data: scan, error: scanError } = await admin
    .from("scans")
    .select("*")
    .eq("id", input.scanId)
    .eq("project_id", input.projectId)
    .maybeSingle();

  if (scanError || !scan) {
    log("verdict_generation_failed", { scanId: input.scanId, reason: "scan_not_found" });
    await emitOperationalEvent(admin, {
      eventType: "verdict_failed",
      scanId: input.scanId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      failureCode: "SCAN_NOT_FOUND",
    });
    return null;
  }

  const scanStatus = String(scan.status ?? "");
  if (scanStatus === "cancelled" || scanStatus === "cancelling") {
    log("verdict_generation_skipped_cancelled", { scanId: input.scanId, status: scanStatus });
    return null;
  }

  const verdictKey = buildIdempotencyKey({
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    commitSha: (scan.commit_sha as string | null) ?? null,
    operationType: "production_verdict",
  });
  if (await hasCompletedSideEffect(admin, verdictKey)) {
    const existing = await getProductionVerdictByScan(admin, input.scanId);
    if (existing) return existing;
  }

  const [{ data: findings }, { data: previousScan }, { data: previousVerdict }] = await Promise.all([
    admin
      .from("scan_findings")
      .select("id, title, severity, category, rule_id, file_path, recommendation, confidence, evidence")
      .eq("scan_id", input.scanId),
    admin
      .from("scans")
      .select("id, security_score, critical_count, high_count")
      .eq("project_id", input.projectId)
      .eq("status", "completed")
      .neq("id", input.scanId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("production_verdicts")
      .select("verdict, blockers_count")
      .eq("project_id", input.projectId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const { data: aiReport } = await admin
    .from("ai_reports")
    .select("executive_summary")
    .eq("scan_id", input.scanId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousBlockers =
    previousVerdict?.blockers_count ??
    (previousScan ? (previousScan.critical_count ?? 0) + (previousScan.high_count ?? 0) : undefined);

  let verdict = runEngine({
    projectId: input.projectId,
    repositoryId: scan.repository_id ?? input.projectId,
    scanId: input.scanId,
    commitSha: scan.commit_sha ?? scan.commit,
    branch: scan.branch,
    scanStatus: scan.status,
    securityScore: scan.security_score,
    filesAnalyzed: scan.files_analyzed ?? scan.files_scanned ?? 0,
    filesDiscovered: scan.files_discovered ?? scan.total_files ?? 0,
    findings: findings ?? [],
    previousScore: previousScan?.security_score ?? null,
    previousBlockersCount: previousBlockers,
    partialScanFailure: scan.status !== "completed",
    aiExecutiveSummary: aiReport?.executive_summary ?? null,
  }).verdict;

  if (input.securityDecisionReport) {
    verdict = applySecurityDecisionToProductionVerdict(verdict, input.securityDecisionReport);
  }

  const correlationId = input.scanId;
  verdict = {
    ...verdict,
    correlationId,
    scanExecutionId: input.scanJobId ?? input.scanId,
  } as ProductionVerdictV1;

  log("verdict_generated", {
    scanId: input.scanId,
    status: verdict.status,
    score: verdict.score,
    blockersCount: verdict.blockersCount,
  });

  const { data: persisted, error: persistError } = await upsertVerdictWithRetry(admin, {
    organization_id: input.organizationId,
    project_id: input.projectId,
    repository_id: scan.repository_id ?? input.projectId,
    scan_id: input.scanId,
    version: verdict.version,
    status: verdict.status,
    score: verdict.score,
    previous_score: verdict.previousScore,
    score_delta: verdict.scoreDelta,
    projected_score: verdict.projectedScore,
    blockers_count: verdict.blockersCount,
    critical_blockers_count: verdict.criticalBlockersCount,
    high_blockers_count: verdict.highBlockersCount,
    estimated_fix_minutes: verdict.estimatedFixMinutes,
    confidence: verdict.confidence,
    executive_summary: verdict.executiveSummary,
    introduced_blockers: verdict.introducedBlockers,
    resolved_blockers: verdict.resolvedBlockers,
    verdict,
    generated_at: verdict.generatedAt,
  });

  if (persistError) {
    log("verdict_persistence_failed", { scanId: input.scanId, error: persistError.message });
    await emitOperationalEvent(admin, {
      eventType: "verdict_failed",
      scanId: input.scanId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      failureCode: "VERDICT_PERSISTENCE_FAILED",
    });
    throw new Error(persistError.message);
  }

  await recordSideEffect(admin, {
    idempotencyKey: verdictKey,
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    operationType: "production_verdict",
  });

  const { error: stateError } = await admin
    .from("repository_scan_state")
    .upsert(
      {
        repository_id: input.projectId,
        organization_id: input.organizationId,
        current_verdict_id: persisted?.id ?? null,
        last_scan_id: input.scanId,
        last_security_score: verdict.score,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "repository_id" }
    );

  if (stateError) {
    log("verdict_state_update_failed", { scanId: input.scanId, error: stateError.message });
    throw new Error(stateError.message);
  }

  log("verdict_persistence_completed", { scanId: input.scanId, verdictId: persisted?.id });
  await emitOperationalEvent(admin, {
    eventType: "verdict_created",
    scanId: input.scanId,
    projectId: input.projectId,
    organizationId: input.organizationId,
  });

  try {
    const { recordReviewCompletedMemory } = await import("@/server/production-memory/record-writes");
    await recordReviewCompletedMemory(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      verdict,
      verdictRowId: persisted?.id ?? null,
      securityScore: scan.security_score ?? null,
      detectedStack: scan.detected_stack,
      trigger: scan.trigger_type === "mcp" ? "mcp" : "web",
    });
  } catch (memoryError) {
    log("memory_record_failed", {
      scanId: input.scanId,
      error: memoryError instanceof Error ? memoryError.message : String(memoryError),
    });
  }

  return verdict;
}

export async function getProductionVerdictByScan(
  admin: SupabaseClient,
  scanId: string
): Promise<ProductionVerdictV1 | null> {
  const { data } = await admin
    .from("production_verdicts")
    .select("verdict")
    .eq("scan_id", scanId)
    .maybeSingle();

  if (!data?.verdict) return null;
  return parseProductionVerdict(data.verdict);
}

export async function getCurrentProductionVerdict(
  admin: SupabaseClient,
  repositoryId: string
): Promise<ProductionVerdictV1 | null> {
  log("verdict_read_started", { repositoryId });

  const { data: state } = await admin
    .from("repository_scan_state")
    .select("current_verdict_id")
    .eq("repository_id", repositoryId)
    .maybeSingle();

  if (state?.current_verdict_id) {
    const { data, error } = await admin
      .from("production_verdicts")
      .select("verdict")
      .eq("id", state.current_verdict_id)
      .maybeSingle();

    if (error && isMissingTableError(error.message)) {
      log("migration_missing", { repositoryId });
      return null;
    }

    if (data?.verdict) {
      log("verdict_read_completed", { repositoryId, source: "current_verdict_id" });
      return parseProductionVerdict(data.verdict);
    }
  }

  const { data, error } = await admin
    .from("production_verdicts")
    .select("verdict")
    .eq("repository_id", repositoryId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) {
      log("migration_missing", { repositoryId });
    } else {
      log("verdict_read_failed", { repositoryId, error: error.message });
    }
    return null;
  }

  if (!data?.verdict) {
    log("verdict_read_empty", { repositoryId });
    return null;
  }

  log("verdict_read_completed", { repositoryId, source: "latest_by_repo" });
  return parseProductionVerdict(data.verdict);
}

export async function compareProductionVerdicts(
  admin: SupabaseClient,
  previousScanId: string,
  currentScanId: string
): Promise<{
  previous: ProductionVerdictV1 | null;
  current: ProductionVerdictV1 | null;
  scoreDelta: number | null;
  blockersDelta: number | null;
} | null> {
  const [previous, current] = await Promise.all([
    getProductionVerdictByScan(admin, previousScanId),
    getProductionVerdictByScan(admin, currentScanId),
  ]);

  if (!previous && !current) return null;

  return {
    previous,
    current,
    scoreDelta:
      previous?.score != null && current?.score != null
        ? current.score - previous.score
        : null,
    blockersDelta:
      previous != null && current != null
        ? current.blockersCount - previous.blockersCount
        : null,
  };
}
