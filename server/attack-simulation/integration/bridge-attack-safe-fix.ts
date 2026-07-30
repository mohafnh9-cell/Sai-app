import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/server/feature-flags";
import { preparePullRequestDraft } from "@/server/safe-fix-engine/pr-preparation";
import { persistGeneratedSafeFix } from "@/server/safe-fix-engine/history";
import { transitionSafeFixState } from "@/server/safe-fix-engine/lifecycle";
import type { SafeFixAssessment } from "@/brain/fix-prompt/assessment";
import type { SafeFixDocumentV2, SafeFixConfidenceBand } from "@/server/safe-fix-engine/types";
import type { AttackFinding } from "../contracts/attack-finding";
import type { AttackMitigation } from "../contracts/attack-mitigation";
import type { AttackSafeFix } from "../contracts/attack-safe-fix";
import { linkAttackSafeFixRecord } from "../persistence/attack-safe-fix-repository";

function confidenceBand(score: number): SafeFixConfidenceBand {
  if (score >= 0.85) return "VERY_HIGH";
  if (score >= 0.7) return "HIGH";
  if (score >= 0.5) return "MEDIUM";
  return "LOW";
}

function buildDocumentFromAttackSafeFix(input: {
  finding: Pick<AttackFinding, "title" | "description" | "impact" | "severity">;
  mitigation: Pick<
    AttackMitigation,
    "recommendedProtection" | "implementationSteps" | "likelyAffectedFiles" | "residualRisk"
  >;
  attackSafeFix: Pick<AttackSafeFix, "cursorPrompt" | "confidence">;
}): SafeFixDocumentV2 {
  return {
    executiveSummary: `${input.finding.title} (${input.finding.severity}) — Safe Fix from attack simulation.`,
    rootCause: input.finding.description,
    whyThisMatters: input.finding.impact,
    riskIfIgnored: input.mitigation.residualRisk,
    proposedImplementation: input.mitigation.recommendedProtection,
    filesToChange:
      input.mitigation.likelyAffectedFiles.length > 0
        ? input.mitigation.likelyAffectedFiles
        : ["Review affected attack boundary."],
    expectedProductionConfidenceImprovement: null,
    expectedProtectionImpact: "Replay the attack scenario to verify protection after applying this fix.",
    expectedSecurityImprovement: "Closes a confirmed attack simulation finding.",
    verificationChecklist: [
      ...input.mitigation.implementationSteps,
      "Replay attack simulation for this finding.",
    ],
    rollbackConsiderations: ["Revert the protection change if legitimate workflows fail."],
    cursorPrompt: input.attackSafeFix.cursorPrompt,
    explanationNarrative: input.attackSafeFix.cursorPrompt,
  };
}

export type BridgeAttackSafeFixResult =
  | { ok: true; skipped: true; reason: "feature_disabled" | "already_linked" }
  | { ok: true; skipped: false; safeFixRecordId: string; attackSafeFixId: string }
  | { ok: false; failureCode: string; safeFailureMessage: string };

export async function bridgeAttackSafeFixToEngine(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    finding: AttackFinding;
    mitigation: AttackMitigation;
    attackSafeFix: AttackSafeFix;
  }
): Promise<BridgeAttackSafeFixResult> {
  if (!isFeatureEnabled("safe_fix_v2", { organizationId: input.organizationId })) {
    return { ok: true, skipped: true, reason: "feature_disabled" };
  }

  if (input.attackSafeFix.safeFixRecordId) {
    return { ok: true, skipped: true, reason: "already_linked" };
  }

  const band = confidenceBand(input.attackSafeFix.confidence);
  const document = buildDocumentFromAttackSafeFix({
    finding: input.finding,
    mitigation: input.mitigation,
    attackSafeFix: input.attackSafeFix,
  });
  const assessment: SafeFixAssessment = {
    safeFixConfidence: Math.round(input.attackSafeFix.confidence * 100),
    implementationRisk:
      input.mitigation.implementationRisk === "high"
        ? "HIGH"
        : input.mitigation.implementationRisk === "medium"
          ? "MEDIUM"
          : "LOW",
    riskReason: input.mitigation.residualRisk,
    estimatedScope: {
      filesExpected: Math.max(input.mitigation.likelyAffectedFiles.length, 1),
      estimatedLocMin: input.mitigation.estimatedLoc ?? 10,
      estimatedLocMax: (input.mitigation.estimatedLoc ?? 10) + 20,
      complexity:
        input.mitigation.implementationRisk === "high"
          ? "high"
          : input.mitigation.implementationRisk === "medium"
            ? "medium"
            : "low",
      complexityLabel: "Attack simulation scoped fix.",
    },
  };
  const prDraft = preparePullRequestDraft({
    projectName: "Project",
    blockerTitle: input.finding.title,
    severity: input.finding.severity,
    document,
    assessment,
  });

  try {
    const record = await persistGeneratedSafeFix(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      recommendationId: `attack:${input.finding.id}`,
      reviewId: input.scanId,
      verdictId: null,
      confidenceBand: band,
      confidenceScore: input.attackSafeFix.confidence,
      document,
      prDraft,
      baseline: {
        source: "attack_simulation_engine",
        attackFindingId: input.finding.id,
        attackSafeFixId: input.attackSafeFix.id,
        campaignId: input.finding.campaignId,
      },
    });

    await transitionSafeFixState(admin, {
      safeFixId: record.id,
      organizationId: input.organizationId,
      projectId: input.projectId,
      toState: "READY",
      actor: "attack_simulation_engine",
      reason: "Attack simulation safe fix bridged to Safe Fix Engine",
      relatedReviewId: input.scanId,
      relatedRecommendationId: `attack:${input.finding.id}`,
    });

    await linkAttackSafeFixRecord(admin, {
      attackSafeFixId: input.attackSafeFix.id,
      organizationId: input.organizationId,
      safeFixRecordId: record.id,
    });

    return {
      ok: true,
      skipped: false,
      safeFixRecordId: record.id,
      attackSafeFixId: input.attackSafeFix.id,
    };
  } catch (error) {
    return {
      ok: false,
      failureCode: "SAFE_FIX_BRIDGE_FAILED",
      safeFailureMessage:
        error instanceof Error ? error.message : "Could not bridge attack safe fix",
    };
  }
}
