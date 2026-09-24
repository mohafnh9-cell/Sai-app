import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseProductionVerdict,
  safeParseProductionVerdict,
  type ProductionVerdictV1,
} from "@/brain/production-verdict/schema";
import { isAnalysisRunImmutable } from "@/server/analysis-runs/is-analysis-run-immutable";
import { generateProductionVerdict as runEngine } from "@/brain/production-verdict/engine";
import { finalizeProductionVerdict } from "@/brain/production-verdict/finalize-verdict";
import { writeScanStatePointer } from "./scan-state-writer";
import { hasIncompleteNativeRuleCoverage, isIncrementalScan } from "@/server/security-scanner/native-coverage";
import { resolveScanCoverageForVerdict } from "@/brain/production-verdict/resolve-scan-coverage";
import { loadPriorScanCoverage } from "@/server/production-verdict/load-prior-scan-coverage";
import {
  buildAttackSimulationVerdictOverlay,
} from "@/server/attack-simulation/integration/build-verdict-overlay";
import { emitOperationalEvent } from "@/server/observability/operational-events";
import {
  hasIncompleteExternalEngineCoverage,
  loadExternalEngineFindingsForVerdict,
} from "@/server/security-orchestrator/verdict-integration";
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
  // Latest verdict per project means the DEFAULT branch's; a feature-branch
  // verdict must never be presented as the project's current verdict.
  const { data: projectRows } = await client
    .from("projects")
    .select("id, github_default_branch")
    .eq("organization_id", organizationId);
  const defaultBranchByProject = new Map<string, string | null>(
    ((projectRows ?? []) as Array<{ id: string; github_default_branch: string | null }>).map((p) => [
      p.id,
      p.github_default_branch ?? null,
    ])
  );

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
      const parsed = safeParseProductionVerdict(row.verdict);
      const defaultBranch = defaultBranchByProject.get(row.project_id) ?? null;
      if (parsed && defaultBranch && parsed.branch && parsed.branch !== defaultBranch) continue;
      if (parsed) map.set(row.project_id, parsed);
    }
  }
  return map;
}

async function insertVerdictIfAbsent(
  admin: SupabaseClient,
  row: Record<string, unknown>,
  maxAttempts = 3
): Promise<{ data: { id: string } | null; error: { message: string } | null; reused: boolean }> {
  const scanId = row.scan_id as string;
  const organizationId = row.organization_id as string;
  const existing = await getProductionVerdictByScan(admin, organizationId, scanId);
  if (existing) {
    const { data } = await admin
      .from("production_verdicts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("scan_id", scanId)
      .maybeSingle();
    return { data: data ? { id: data.id as string } : null, error: null, reused: true };
  }

  let lastError: { message: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await admin
      .from("production_verdicts")
      .insert(row)
      .select("id")
      .single();

    if (!error) {
      return { data: data ? { id: data.id as string } : null, error: null, reused: false };
    }

    if (error.code === "23505") {
      const { data: raced } = await admin
        .from("production_verdicts")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("scan_id", scanId)
        .maybeSingle();
      return { data: raced ? { id: raced.id as string } : null, error: null, reused: true };
    }

    lastError = error;
    if (attempt < maxAttempts) {
      await sleep(150 * attempt);
    }
  }

  return { data: null, error: lastError, reused: false };
}

export async function generateAndPersistProductionVerdict(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    scanJobId?: string | null;
    /** Authoritative Security Decision from unified scan pipeline (single verdict source). */
    // Only the fields finalizeProductionVerdict reads (a full SecurityDecisionReport satisfies this).
    securityDecisionReport?: import("@/brain/production-verdict/finalize-verdict").SecurityDecisionFinalizeInput | null;
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

  const existingRunVerdict = await getProductionVerdictByScan(
    admin,
    input.organizationId,
    input.scanId
  );
  if (
    existingRunVerdict &&
    isAnalysisRunImmutable({
      status: scanStatus,
      immutabilityLockedAt: (scan.immutability_locked_at as string | null) ?? null,
    })
  ) {
    log("verdict_generation_skipped_immutable", { scanId: input.scanId });
    return existingRunVerdict;
  }

  const verdictKey = buildIdempotencyKey({
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    commitSha: (scan.commit_sha as string | null) ?? null,
    operationType: "production_verdict",
  });
  if (await hasCompletedSideEffect(admin, verdictKey)) {
    const existing = await getProductionVerdictByScan(admin, input.organizationId, input.scanId);
    if (existing) return existing;
  }

  const [{ data: findings }, { data: previousScan }, { data: previousVerdict }] = await Promise.all([
    admin
      .from("scan_findings")
      .select("id, title, severity, category, rule_id, file_path, start_line, recommendation, confidence, evidence, metadata")
      .eq("scan_id", input.scanId),
    admin
      .from("scans")
      .select("id, security_score, critical_count, high_count, files_analyzed, files_discovered")
      .eq("project_id", input.projectId)
      .eq("status", "completed")
      .neq("id", input.scanId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("production_verdicts")
      .select("verdict, blockers_count")
      .eq("organization_id", input.organizationId)
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

  const previousVerdictParsed = previousVerdict?.verdict
    ? parseProductionVerdict(previousVerdict.verdict)
    : null;

  const previousBlockers =
    previousVerdict?.blockers_count ??
    (previousScan ? (previousScan.critical_count ?? 0) + (previousScan.high_count ?? 0) : undefined);

  const attackOverlay = await buildAttackSimulationVerdictOverlay(admin, {
    scanId: input.scanId,
    organizationId: input.organizationId,
    projectId: input.projectId,
  });

  const priorCoverage = await loadPriorScanCoverage(admin, {
    projectId: input.projectId,
    excludeScanId: input.scanId,
  });
  const coverage = resolveScanCoverageForVerdict({
    filesAnalyzed: (scan.files_analyzed as number | null) ?? (scan.files_scanned as number | null) ?? 0,
    filesDiscovered: (scan.files_discovered as number | null) ?? (scan.total_files as number | null) ?? 0,
    priorScan: isIncrementalScan({ scan_type: scan.scan_type, metrics: scan.metrics })
      ? priorCoverage
      : null,
  });

  if (
    coverage.inheritedFromPrior &&
    ((scan.files_analyzed as number | null) ?? 0) < 3
  ) {
    await admin
      .from("scans")
      .update({
        files_analyzed: coverage.filesAnalyzed,
        files_discovered: coverage.filesDiscovered,
      })
      .eq("id", input.scanId);
  }

  // Phase 37, workstream C: fold external-engine findings (OpenGrep/Trivy/
  // Crypto/Scorecard) into the SAME scoring input native findings already
  // use -- see verdict-integration.ts for the exact dedup/suppression
  // rules. Best-effort: a failure here must never block verdict
  // generation from native findings alone.
  const nativeFindings = findings ?? [];
  const nativeFindingIds = new Set(nativeFindings.map((f) => f.id as string).filter(Boolean));
  const [externalFindings, externalEngineCoverageIncomplete] = await Promise.all([
    loadExternalEngineFindingsForVerdict(admin, {
      scanId: input.scanId,
      organizationId: input.organizationId,
      nativeFindingIds,
    }).catch((error) => {
      log("external_findings_merge_failed", { scanId: input.scanId, message: error instanceof Error ? error.message : String(error) });
      return [];
    }),
    // F10: a failed/incomplete external-engine job (opengrep/trivy/crypto)
    // must make partialScanFailure true even when the native scan itself
    // completed cleanly -- see hasIncompleteExternalEngineCoverage's own
    // doc comment for the gap this closes. A read failure here defaults to
    // true (assume incomplete) for the same honesty reason.
    hasIncompleteExternalEngineCoverage(admin, {
      scanId: input.scanId,
      organizationId: input.organizationId,
    }).catch(() => true),
  ]);
  const mergedFindings = [...nativeFindings, ...externalFindings];

  const baseVerdict = runEngine({
    projectId: input.projectId,
    repositoryId: scan.repository_id ?? input.projectId,
    scanId: input.scanId,
    commitSha: scan.commit_sha ?? scan.commit,
    branch: scan.branch,
    scanStatus: scan.status,
    securityScore: scan.security_score,
    filesAnalyzed: coverage.filesAnalyzed,
    filesDiscovered: coverage.filesDiscovered,
    findings: mergedFindings,
    previousScore: previousVerdictParsed?.score ?? null,
    previousBlockersCount: previousBlockers,
    // A native rule that threw or never ran (time budget) is missing
    // evidence, exactly like a failed external engine: never "found nothing".
    partialScanFailure:
      scan.status !== "completed" ||
      externalEngineCoverageIncomplete ||
      hasIncompleteNativeRuleCoverage({ metrics: scan.metrics, omissions: scan.omissions }),
    aiExecutiveSummary: aiReport?.executive_summary ?? null,
  }).verdict;

  const correlationId = input.scanId;
  let verdict = finalizeProductionVerdict({
    verdict: {
      ...baseVerdict,
      correlationId,
      scanExecutionId: input.scanJobId ?? input.scanId,
    },
    securityDecisionReport: input.securityDecisionReport ?? null,
    attackSimulation: attackOverlay,
  });

  log("verdict_generated", {
    scanId: input.scanId,
    status: verdict.status,
    score: verdict.score,
    blockersCount: verdict.blockersCount,
  });

  const { data: persisted, error: persistError, reused: verdictReused } =
    await insertVerdictIfAbsent(admin, {
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

  if (verdictReused) {
    log("verdict_insert_skipped_immutable", { scanId: input.scanId });
    const existing = await getProductionVerdictByScan(admin, input.organizationId, input.scanId);
    if (!existing) {
      throw new Error(
        `VERDICT_INSERT_REUSED_WITHOUT_ROW: scan=${input.scanId} project=${input.projectId}`
      );
    }
    return existing;
  }

  if (!persisted?.id) {
    throw new Error(
      `VERDICT_PERSISTENCE_EMPTY: scan=${input.scanId} project=${input.projectId}`
    );
  }

  await recordSideEffect(admin, {
    idempotencyKey: verdictKey,
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    operationType: "production_verdict",
  });

  // The current-verdict pointer only moves forward (see scan-state-writer):
  // a delayed older scan must not replace a newer scan's verdict, and a
  // non-default-branch scan must not become the project's production verdict.
  let pointerResult: Awaited<ReturnType<typeof writeScanStatePointer>>;
  try {
    pointerResult = await writeScanStatePointer(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      values: {
        current_verdict_id: persisted?.id ?? null,
        last_scan_id: input.scanId,
        last_security_score: verdict.score,
      },
    });
  } catch (stateError) {
    const message = stateError instanceof Error ? stateError.message : String(stateError);
    log("verdict_state_update_failed", { scanId: input.scanId, error: message });
    throw new Error(message);
  }
  if (!pointerResult.applied) {
    log("verdict_state_pointer_skipped", { scanId: input.scanId, reason: pointerResult.reason });
  }

  log("verdict_persistence_completed", { scanId: input.scanId, verdictId: persisted?.id });
  await emitOperationalEvent(admin, {
    eventType: "verdict_created",
    scanId: input.scanId,
    projectId: input.projectId,
    organizationId: input.organizationId,
  });

  try {
    // Phase 30: selective AI reasoning overlay -- runs after the
    // deterministic verdict is already persisted above, so its own success,
    // failure, timeout, or unavailability can never affect the verdict this
    // function already returned/committed. Purely additive; see
    // server/ai-reasoning/run-scan-reasoning.ts for the full authority model.
    const { runScanAiReasoning } = await import("@/server/ai-reasoning/run-scan-reasoning");
    await runScanAiReasoning(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
    });
  } catch (aiReasoningError) {
    log("ai_reasoning_unexpected_error", {
      scanId: input.scanId,
      error: aiReasoningError instanceof Error ? aiReasoningError.message : String(aiReasoningError),
    });
  }

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
  organizationId: string,
  scanId: string
): Promise<ProductionVerdictV1 | null> {
  const { data } = await admin
    .from("production_verdicts")
    .select("verdict")
    .eq("organization_id", organizationId)
    .eq("scan_id", scanId)
    .maybeSingle();

  if (!data?.verdict) return null;
  const parsed = safeParseProductionVerdict(data.verdict);
  if (!parsed) {
    log("verdict_parse_failed", { scanId });
    return null;
  }
  return parsed;
}

export async function getCurrentProductionVerdict(
  admin: SupabaseClient,
  organizationId: string,
  projectId: string
): Promise<ProductionVerdictV1 | null> {
  log("verdict_read_started", { organizationId, projectId });

  const { data: state } = await admin
    .from("repository_scan_state")
    .select("current_verdict_id")
    .eq("organization_id", organizationId)
    .eq("repository_id", projectId)
    .maybeSingle();

  if (state?.current_verdict_id) {
    const { data, error } = await admin
      .from("production_verdicts")
      .select("verdict")
      .eq("organization_id", organizationId)
      .eq("id", state.current_verdict_id)
      .maybeSingle();

    if (error && isMissingTableError(error.message)) {
      log("migration_missing", { projectId });
      return null;
    }

    if (data?.verdict) {
      log("verdict_read_completed", { projectId, source: "current_verdict_id" });
      const parsed = safeParseProductionVerdict(data.verdict);
      if (!parsed) {
        log("verdict_parse_failed", { projectId, source: "current_verdict_id" });
        return null;
      }
      return parsed;
    }
  }

  const { data, error } = await admin
    .from("production_verdicts")
    .select("verdict")
    .eq("organization_id", organizationId)
    .eq("project_id", projectId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) {
      log("migration_missing", { projectId });
    } else {
      log("verdict_read_failed", { projectId, error: error.message });
    }
    return null;
  }

  if (!data?.verdict) {
    log("verdict_read_empty", { projectId });
    return null;
  }

  log("verdict_read_completed", { projectId, source: "latest_by_project" });
  const parsed = safeParseProductionVerdict(data.verdict);
  if (!parsed) {
    log("verdict_parse_failed", { projectId, source: "latest_by_project" });
    return null;
  }
  return parsed;
}

export async function compareProductionVerdicts(
  admin: SupabaseClient,
  organizationId: string,
  previousScanId: string,
  currentScanId: string
): Promise<{
  previous: ProductionVerdictV1 | null;
  current: ProductionVerdictV1 | null;
  scoreDelta: number | null;
  blockersDelta: number | null;
} | null> {
  const [previous, current] = await Promise.all([
    getProductionVerdictByScan(admin, organizationId, previousScanId),
    getProductionVerdictByScan(admin, organizationId, currentScanId),
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
