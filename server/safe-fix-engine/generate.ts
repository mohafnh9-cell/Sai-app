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
import { persistGeneratedSafeFix, supersedeOpenFixesForRecommendation } from "./history";
import { transitionSafeFixState } from "./lifecycle";
import { appendSafeFixMemoryEvent } from "./memory-bridge";
import type { SafeFixRecord } from "./types";
import { incrementMetricCounter } from "@/server/observability/metrics";
import { withOperationTiming } from "@/server/observability/operation-timing";

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
): Promise<
  | { status: "no_blockers" }
  | { status: "choose_blocker"; blockers: Array<{ id: string; title: string; severity: string }> }
  | { status: "ready"; record: SafeFixRecord }
> {
  return withOperationTiming(
    "safe_fix.generate",
    () => generateSafeFixInner(admin, input),
    { projectId: input.projectId, organizationId: input.organizationId }
  );
}

async function generateSafeFixInner(
  admin: SupabaseClient,
  input: GenerateSafeFixInput
): Promise<
  | { status: "no_blockers" }
  | { status: "choose_blocker"; blockers: Array<{ id: string; title: string; severity: string }> }
  | { status: "ready"; record: SafeFixRecord }
> {
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

  await supersedeOpenFixesForRecommendation(admin, input.projectId, recommendationId);

  const record = await persistGeneratedSafeFix(admin, {
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
    },
  });

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

  incrementMetricCounter("safe_fix_generated_total");
  return { status: "ready", record };
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
