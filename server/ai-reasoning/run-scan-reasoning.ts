import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isEligibleForAiReasoning } from "@/features/security-scanner/rules/ai-reasoning-classification";
import { assertAiBudgetAvailable, AiBudgetExceededError } from "@/server/ai-security-engine/budget";
import { analyzeCategoryCFindings } from "./analyze";
import { buildBoundedEvidence, computeEvidenceHash, type ScanFindingRow } from "./build-context";
import { findCachedReasoning, persistReasoningOverlay } from "./persist";
import { AI_REASONING_VERSION, AiReasoningResponseSchema, type AiReasoningOverlay } from "./schema";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "ai-finding-reasoning", event, ...fields });
}

export type RunScanReasoningInput = {
  organizationId: string;
  projectId: string;
  scanId: string;
};

/**
 * Phase 30 entry point. Called AFTER the deterministic Production Verdict
 * has already been generated and persisted (see
 * server/production-verdict/core.ts) -- this function's own success or
 * failure can never affect the verdict, which is already committed by the
 * time this runs. Every branch below either persists a `skipped`/`failed`
 * row or returns silently; nothing here throws to the caller.
 */
export async function runScanAiReasoning(
  admin: SupabaseClient,
  input: RunScanReasoningInput
): Promise<void> {
  const startedAt = Date.now();

  try {
    // Tenant-scoped by construction: both the finding query and every
    // downstream write are filtered by organization_id AND project_id AND
    // scan_id together, never by scan_id alone.
    const { data: findingRows, error } = await admin
      .from("scan_findings")
      .select("id, title, severity, category, rule_id, file_path, start_line, recommendation, confidence, evidence")
      .eq("scan_id", input.scanId)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId);

    if (error) {
      log("findings_read_failed", { scanId: input.scanId, error: error.message });
      return;
    }

    const allFindings = (findingRows ?? []) as ScanFindingRow[];
    const eligible = allFindings.filter((f) => isEligibleForAiReasoning(f.rule_id));

    if (eligible.length === 0) {
      // Selective execution: Category A/B-only scans make zero Claude calls.
      await persistReasoningOverlay(admin, emptyOverlay(input, "skipped", null, startedAt, false));
      log("skipped_no_eligible_findings", { scanId: input.scanId });
      return;
    }

    const evidenceHash = computeEvidenceHash(eligible);
    const analyzedFindingIds = eligible.map((f) => f.id);

    const cached = await findCachedReasoning(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      evidenceHash,
    });

    if (cached) {
      const revalidated = AiReasoningResponseSchema.safeParse({
        findings: cached.findings,
        attackChains: cached.attackChains,
      });
      await persistReasoningOverlay(admin, {
        version: AI_REASONING_VERSION,
        status: "completed",
        model: cached.model,
        scanId: input.scanId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        analyzedFindingIds,
        evidenceHash,
        findings: revalidated.success ? revalidated.data.findings ?? [] : [],
        attackChains: revalidated.success ? revalidated.data.attackChains ?? [] : [],
        failureReason: null,
        tokensUsed: 0,
        durationMs: Date.now() - startedAt,
        cacheHit: true,
        generatedAt: new Date().toISOString(),
      });
      log("cache_hit", { scanId: input.scanId, evidenceHash, eligibleCount: eligible.length });
      return;
    }

    try {
      await assertAiBudgetAvailable(admin, input.organizationId, ["ai_reports", "ai_finding_reasoning"]);
    } catch (budgetError) {
      const reason = budgetError instanceof AiBudgetExceededError ? "budget_exceeded" : "unknown_error";
      await persistReasoningOverlay(
        admin,
        emptyOverlay(input, "failed", reason, startedAt, false, analyzedFindingIds, evidenceHash)
      );
      log("budget_exceeded", { scanId: input.scanId });
      return;
    }

    const evidence = buildBoundedEvidence(eligible);
    // Exactly one bounded Claude call per scan for all eligible findings
    // combined -- never one call per finding.
    const result = await analyzeCategoryCFindings(evidence);

    if (!result.ok) {
      await persistReasoningOverlay(
        admin,
        emptyOverlay(input, "failed", result.reason, startedAt, false, analyzedFindingIds, evidenceHash)
      );
      log("analysis_failed", { scanId: input.scanId, reason: result.reason, detail: result.detail });
      return;
    }

    await persistReasoningOverlay(admin, {
      version: AI_REASONING_VERSION,
      status: "completed",
      model: result.model,
      scanId: input.scanId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      analyzedFindingIds,
      evidenceHash,
      findings: result.findings,
      attackChains: result.attackChains,
      failureReason: null,
      tokensUsed: result.tokensUsed,
      durationMs: Date.now() - startedAt,
      cacheHit: false,
      generatedAt: new Date().toISOString(),
    });
    log("completed", {
      scanId: input.scanId,
      eligibleCount: eligible.length,
      findingsReturned: result.findings.length,
      attackChains: result.attackChains.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (unexpected) {
    // Absolute backstop: no matter what goes wrong above, AI reasoning
    // failure must never propagate to the scan/verdict caller.
    log("unexpected_error", {
      scanId: input.scanId,
      message: unexpected instanceof Error ? unexpected.message : String(unexpected),
    });
  }
}

function emptyOverlay(
  input: RunScanReasoningInput,
  status: "skipped" | "failed",
  failureReason: string | null,
  startedAt: number,
  cacheHit: boolean,
  analyzedFindingIds: string[] = [],
  evidenceHash = ""
): AiReasoningOverlay {
  return {
    version: AI_REASONING_VERSION,
    status,
    model: null,
    scanId: input.scanId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    analyzedFindingIds,
    evidenceHash,
    findings: [],
    attackChains: [],
    failureReason: failureReason as AiReasoningOverlay["failureReason"],
    tokensUsed: 0,
    durationMs: Date.now() - startedAt,
    cacheHit,
    generatedAt: new Date().toISOString(),
  };
}
