import { resolveTargetFindings } from "./verification-evidence";
import "server-only";

import {
  buildProductionFixPrompt,
  fixPromptInputFromFinding,
  fixPromptInputFromPriority,
  projectedScoreAfterFix,
  projectedVerdictStatusAfterFix,
  stackFromDetectedStack,
} from "@/brain/fix-prompt";
import type { ProductionPriority } from "@/brain/production-verdict/schema";
import {
  getCurrentProductionVerdict,
  getProductionVerdictByScan,
} from "@/server/production-verdict/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateSafeFixConfidence, historicalSuccessRate } from "./confidence";
import { buildFromPromptInput } from "./v2-document";
import { preparePullRequestDraft } from "./pr-preparation";
import {
  IN_FLIGHT_STATES,
  getSafeFixById,
  isUniqueViolation,
  listOpenFixesForRecommendation,
  persistGeneratedSafeFix,
  pickSurvivingFix,
  supersedeReplaceableFixes,
} from "./history";
import { transitionSafeFixState } from "./lifecycle";
import { appendSafeFixMemoryEvent } from "./memory-bridge";
import type { SafeFixRecord } from "./types";
import { incrementMetricCounter } from "@/server/observability/metrics";
import { withOperationTiming } from "@/server/observability/operation-timing";

/**
 * ready: a proposal for this recommendation and this base analysis (`reused` = an existing one was returned, nothing new was
 *   created -- the call is idempotent).
 * in_flight: a correction for this recommendation is already approved/applied/being verified on a DIFFERENT base analysis, so
 *   a new proposal is refused and the existing record is kept untouched. The caller must finish or reopen that one.
 */
export type GenerateSafeFixResult =
  | { status: "no_blockers" }
  | { status: "choose_blocker"; blockers: Array<{ id: string; title: string; severity: string }> }
  | { status: "ready"; record: SafeFixRecord; reused?: boolean }
  | { status: "in_flight"; record: SafeFixRecord; reason: "different_base_analysis" };

export type GenerateSafeFixInput = {
  organizationId: string;
  projectId: string;
  projectName: string;
  blockerId?: string;
  priorityId?: string;
  findingId?: string;
  analysisRunId?: string;
  actor?: string;
};

export async function generateSafeFix(
  admin: SupabaseClient,
  input: GenerateSafeFixInput
): Promise<GenerateSafeFixResult> {
  const result = await withOperationTiming(
    "safe_fix.generate",
    () => generateSafeFixInner(admin, input),
    { projectId: input.projectId, organizationId: input.organizationId }
  );
  return withPersistedRecord(admin, { organizationId: input.organizationId, projectId: input.projectId }, result);
}

/**
 * Every result that carries a record reports what is PERSISTED now, not the object captured earlier in the call: a new
 * record is inserted as PROPOSED and moved to READY right after, a reused or in-flight one may have changed state since it
 * was listed. Reading it back is one scoped query; if it cannot be read the captured record is returned unchanged.
 */
async function withPersistedRecord(
  admin: SupabaseClient,
  scope: { organizationId: string; projectId: string },
  result: GenerateSafeFixResult
): Promise<GenerateSafeFixResult> {
  if (result.status !== "ready" && result.status !== "in_flight") return result;
  const persisted = await getSafeFixById(admin, result.record.id, scope).catch(() => null);
  return persisted ? { ...result, record: persisted } : result;
}

async function generateSafeFixInner(
  admin: SupabaseClient,
  input: GenerateSafeFixInput
): Promise<GenerateSafeFixResult> {
  const requestedId = input.blockerId?.trim() || input.priorityId?.trim() || input.findingId?.trim();
  const verdict = input.analysisRunId
    ? await getProductionVerdictByScan(admin, input.organizationId, input.analysisRunId)
    : await getCurrentProductionVerdict(admin, input.organizationId, input.projectId);
  if (!verdict) throw new Error("no_verdict");

  if (verdict.blockersCount === 0 && verdict.topPriorities.length === 0) {
    return { status: "no_blockers" };
  }

  if (!requestedId) {
    return {
      status: "choose_blocker",
      blockers: verdict.topPriorities.slice(0, 5).map((p) => ({
        id: p.id,
        title: p.title,
        severity: p.severity,
      })),
    };
  }

  const matchedPriority = verdict.topPriorities.find(
    (p) => p.id === requestedId || p.findingIds.includes(requestedId)
  );

  let promptInput;
  let recommendationId: string;
  let priority: ProductionPriority | null = null;

  if (matchedPriority) {
    priority = matchedPriority;
    const { data: scan } = await admin
      .from("scans")
      .select("detected_stack")
      .eq("id", verdict.scanId)
      .maybeSingle();
    promptInput = fixPromptInputFromPriority(matchedPriority, {
      projectName: input.projectName,
      stack: stackFromDetectedStack(scan?.detected_stack),
      currentVerdictStatus: verdict.status,
      currentScore: verdict.score,
    });
    recommendationId = matchedPriority.id;
  } else {
    const { data: finding } = await admin
      .from("scan_findings")
      .select("*")
      .eq("id", requestedId)
      .maybeSingle();
    if (!finding) throw new Error("blocker_not_found");
    if (input.analysisRunId && finding.scan_id !== input.analysisRunId) {
      throw new Error("finding_run_mismatch");
    }
    const { data: scan } = await admin
      .from("scans")
      .select("detected_stack")
      .eq("id", finding.scan_id)
      .maybeSingle();
    promptInput = fixPromptInputFromFinding(
      {
        id: finding.id,
        title: finding.title,
        description: finding.description ?? undefined,
        severity: finding.severity,
        category: finding.category,
        recommendation: finding.recommendation ?? undefined,
        file_path: finding.file_path ?? undefined,
        start_line: finding.start_line ?? undefined,
        impact: finding.impact ?? undefined,
      },
      {
        projectName: input.projectName,
        stack: stackFromDetectedStack(scan?.detected_stack),
        currentVerdictStatus: verdict.status,
        currentScore: verdict.score,
      }
    );
    recommendationId = finding.id as string;
  }

  // Idempotency and in-flight protection, decided BEFORE anything is generated or written.
  const scope = { organizationId: input.organizationId, projectId: input.projectId };
  const existing = await resolveExistingFix(admin, scope, recommendationId, verdict.scanId);
  if (existing) return existing;

  const fixResult = buildProductionFixPrompt(promptInput);
  const { verified, failed } = await countVerificationOutcomes(admin, input.projectId);
  const { band, score } = calculateSafeFixConfidence({
    confidenceScore: fixResult.assessment.safeFixConfidence,
    implementationRisk: fixResult.assessment.implementationRisk,
    affectedFileCount: promptInput.affectedFiles.length,
    hasRecommendedAction: promptInput.recommendedAction.trim().length >= 20,
    historicalSuccessRate: historicalSuccessRate(verified, failed),
  });

  const { document } = buildFromPromptInput(promptInput, band);
  const prDraft = preparePullRequestDraft({
    projectName: input.projectName,
    blockerTitle: promptInput.issueTitle,
    severity: promptInput.severity,
    document,
    assessment: fixResult.assessment,
  });

  // Older, never-approved proposals for this recommendation are replaceable. In-flight ones never are (the state condition
  // is part of the UPDATE, so an approval that lands in between wins).
  const open = await listOpenFixesForRecommendation(admin, scope, recommendationId);
  await supersedeReplaceableFixes(admin, scope, open.filter((r) => r.reviewId !== verdict.scanId).map((r) => r.id));

  // Preserve the exact finding identity this fix targets, so verification can
  // later prove THOSE findings are gone rather than infer it from counts.
  const resolvedTargets = await resolveTargetFindings(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    baselineScanId: verdict.scanId,
    recommendationId,
  }).catch(() => ({ targets: [], fullyResolved: false }));

  let record: SafeFixRecord;
  try {
    record = await persistGeneratedSafeFix(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      recommendationId,
      reviewId: verdict.scanId,
      verdictId: null,
      confidenceBand: band,
      confidenceScore: score,
      document,
      prDraft,
      baseline: {
        verdictStatus: verdict.status,
        score: verdict.score,
        blockersCount: verdict.blockersCount,
        priorityTitle: priority?.title ?? promptInput.issueTitle,
        // Empty when identity could not be fully resolved; verification then
        // re-resolves from the baseline scan and otherwise fails closed.
        targetFindings: resolvedTargets.fullyResolved ? resolvedTargets.targets : [],
      },
    });
  } catch (error) {
    // A concurrent request created (or approved) the open correction first (unique index, migration 068): hand back the winner.
    if (!isUniqueViolation(error)) throw error;
    const winner = await resolveExistingFix(admin, scope, recommendationId, verdict.scanId);
    if (winner) return winner;
    throw error;
  }

  await transitionSafeFixState(admin, {
    safeFixId: record.id,
    organizationId: input.organizationId,
    projectId: input.projectId,
    toState: "READY",
    actor: input.actor ?? "system",
    reason: "generation_complete",
    relatedRecommendationId: recommendationId,
    relatedReviewId: verdict.scanId,
  });

  await appendSafeFixMemoryEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "safe_fix_proposed",
    payload: {
      safeFixId: record.id,
      recommendationId,
      confidenceBand: band,
      confidenceScore: score,
    },
    idempotencyKey: `safe_fix_proposed:${record.id}`,
  });

  // Concurrent creators (no unique index yet) can both have inserted. Every caller computes the same survivor; the others
  // are superseded only while still replaceable, and a caller whose record lost returns the survivor instead.
  const afterInsert = await listOpenFixesForRecommendation(admin, scope, recommendationId);
  const survivor = pickSurvivingFix(afterInsert);
  if (survivor && survivor.id !== record.id) {
    await supersedeReplaceableFixes(admin, scope, afterInsert.filter((r) => r.id !== survivor.id).map((r) => r.id));
    return survivor.reviewId === verdict.scanId
      ? { status: "ready", record: survivor, reused: true }
      : { status: "in_flight", record: survivor, reason: "different_base_analysis" };
  }
  if (survivor) {
    await supersedeReplaceableFixes(admin, scope, afterInsert.filter((r) => r.id !== survivor.id).map((r) => r.id));
  }

  incrementMetricCounter("safe_fix_generated_total");
  return { status: "ready", record };
}

/** An open correction already answers this request, or one in flight on another base analysis blocks it. */
async function resolveExistingFix(
  admin: SupabaseClient,
  scope: { organizationId: string; projectId: string },
  recommendationId: string,
  baseScanId: string
): Promise<GenerateSafeFixResult | null> {
  const open = await listOpenFixesForRecommendation(admin, scope, recommendationId);
  const inFlight = open.find((r) => IN_FLIGHT_STATES.has(r.lifecycleState)); // oldest first
  if (inFlight) {
    return inFlight.reviewId === baseScanId
      ? { status: "ready", record: inFlight, reused: true }
      : { status: "in_flight", record: inFlight, reason: "different_base_analysis" };
  }
  const sameBase = open.find((r) => r.reviewId === baseScanId);
  if (sameBase) return { status: "ready", record: sameBase, reused: true };
  return null; // only replaceable proposals of an older base (or none): a new proposal supersedes them
}

async function countVerificationOutcomes(admin: SupabaseClient, projectId: string) {
  const { data } = await admin
    .from("safe_fix_verifications")
    .select("outcome")
    .eq("project_id", projectId)
    .limit(200);
  const verified = (data ?? []).filter((r) => r.outcome === "passed").length;
  const failed = (data ?? []).filter((r) => r.outcome === "failed").length;
  return { verified, failed };
}

export function summarizeProjectedImpact(promptInput: Parameters<typeof projectedScoreAfterFix>[0]) {
  return {
    projectedScore: projectedScoreAfterFix(promptInput),
    projectedStatus: projectedVerdictStatusAfterFix(promptInput),
  };
}
