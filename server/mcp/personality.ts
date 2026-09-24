import "server-only";

import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { DeploymentDecision } from "./decision-mapping";
import type { DeployDeferReason } from "./deploy-decision/evaluate-deploy-decision";
import { shortSha } from "./deploy-decision/evaluate-deploy-decision";
import { guardDecisionText, type DecisionLanguagePolicy } from "./decision-language-policy";
import type { McpTranslator } from "./i18n";
import { buildTextResponse, type McpMode } from "./response-format";

export type StalenessFootnotes = {
  reviewInProgress: boolean;
  freshnessStatus: "current" | "stale" | "unknown";
  reviewFailed: boolean;
  latestDetectedCommitSha: string | null;
};

function truncateExplanation(text: string, max = 280): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trim()}…`;
}

function worriesBlock(t: McpTranslator, worries: string[]): string[] {
  const lines = [t("blocks.worriesHeader")];
  if (worries.length === 0) {
    lines.push(`- ${t("blocks.noWorries")}`);
  } else {
    for (const title of worries.slice(0, 3)) {
      lines.push(`- ${title}`);
    }
  }
  return lines;
}

function recommendedActionBlock(t: McpTranslator, action: string): string[] {
  return ["", t("blocks.recommendedActionHeader"), action];
}

export function pickRecommendedAction(
  t: McpTranslator,
  input: {
    decision: DeploymentDecision;
    status: VerdictStatus;
    blockersCount: number;
    staleness: StalenessFootnotes;
    policy?: DecisionLanguagePolicy;
  }
): string {
  if (input.policy?.strength === "QUALIFIED") return t("actions.gatherMoreEvidence");
  if (input.policy?.strength === "SUPPORTED") return t("actions.reviewUnevaluated");
  if (input.staleness.reviewInProgress) return t("actions.waitForReview");
  if (input.staleness.freshnessStatus === "stale" || input.staleness.reviewFailed) {
    return t("actions.reviewAgain");
  }
  if (input.status === "insufficient_data" || input.status === "analysis_failed") {
    return t("actions.runFirstReview");
  }
  if (input.decision === "deploy") {
    return input.policy && input.policy.strength !== "HIGH_CONFIDENCE"
      ? t("actions.reviewUnevaluated")
      : t("actions.shipWhenReady");
  }
  if (input.blockersCount > 0 || input.decision === "do_not_deploy") {
    return t("actions.applySafeFix");
  }
  return t("actions.reviewAgain");
}

function stalenessFootnotes(t: McpTranslator, staleness: StalenessFootnotes): string[] {
  const lines: string[] = [];
  if (staleness.reviewInProgress) {
    lines.push("", t("canIDeploy.reviewInProgress"));
  }
  if (staleness.freshnessStatus === "stale") {
    lines.push(
      "",
      t("canIDeploy.staleWarning", {
        commitSha: staleness.latestDetectedCommitSha?.slice(0, 7) ?? "",
      })
    );
  } else if (staleness.freshnessStatus === "unknown") {
    lines.push("", t("canIDeploy.freshnessUnknown"));
  }
  if (staleness.reviewFailed) {
    lines.push("", t("canIDeploy.reviewFailedWarning"));
  }
  return lines;
}

/**
 * Used when the newest review has not completed — do not emit YES/NO/NOT YET
 * from an older completed verdict.
 */
export function formatCanIDeployDeferredResponse(
  t: McpTranslator,
  input: {
    reason: DeployDeferReason;
    currentCommitSha: string | null;
    historicalVerdict: {
      commitSha: string | null;
      status: VerdictStatus;
      score: number | null;
    };
  }
): string {
  const currentSha = shortSha(input.currentCommitSha);
  const historicalSha = shortSha(input.historicalVerdict.commitSha);
  const historicalScore =
    input.historicalVerdict.score != null ? String(input.historicalVerdict.score) : "—";

  const leadKey =
    input.reason === "failed"
      ? "canIDeploy.pendingReviewFailedLead"
      : input.reason === "timed_out"
        ? "canIDeploy.pendingReviewTimedOutLead"
        : input.reason === "in_progress" || input.reason === "awaiting_verdict"
          ? "canIDeploy.pendingReviewLead"
          : "canIDeploy.pendingReviewRetryLead";

  const lines = [
    t(leadKey, { currentSha }),
    "",
    t("canIDeploy.pendingReviewHistorical", {
      historicalSha,
      historicalStatus: input.historicalVerdict.status,
      historicalScore,
    }),
    "",
    t("canIDeploy.pendingReviewFinish"),
    "",
    ...recommendedActionBlock(t, t("actions.waitForReview")),
  ];

  return buildTextResponse("production_review", t, lines);
}

/**
 * Founder-first deploy / protect / company-opinion answer — one response fits
 * "Can I deploy?", "Am I protected?", and "Would you deploy if it was your company?"
 */
export function formatCanIDeployResponse(
  t: McpTranslator,
  input: {
    decision: DeploymentDecision;
    status: VerdictStatus;
    executiveSummary: string;
    worries: string[];
    blockersCount: number;
    staleness: StalenessFootnotes;
    policy: DecisionLanguagePolicy;
  }
): string {
  const lines: string[] = [];
  const policy = input.policy;

  if (input.status === "insufficient_data") {
    lines.push(t("canIDeploy.cantAnswerLead"));
    lines.push("");
    lines.push(t("canIDeploy.cantAnswerComfort"));
    lines.push("");
    // SECURITY: never surface the persisted verdict's own executiveSummary
    // text here. It can be overwritten at verdict-generation time by a
    // secondary security-decision subsystem's narrative (e.g. "Safe to
    // deploy based on current authorized security evidence.") even when
    // this verdict's own status is insufficient_data -- that text would
    // directly contradict the conservative "I can't answer responsibly
    // yet" framing two lines above. Insufficient coverage always uses the
    // fixed, safe canonical message; no persisted narrative is trusted
    // for this status, regardless of what generated it.
    lines.push(truncateExplanation(t("canIDeploy.insufficientData")));
    lines.push(...recommendedActionBlock(t, pickRecommendedAction(t, input)));
    lines.push(...stalenessFootnotes(t, input.staleness));
    return buildTextResponse("production_review", t, lines);
  }

  if (input.status === "analysis_failed") {
    lines.push(t("canIDeploy.cantAnswerLead"));
    lines.push("");
    lines.push(t("canIDeploy.analysisFailed"));
    lines.push(...recommendedActionBlock(t, pickRecommendedAction(t, input)));
    lines.push(...stalenessFootnotes(t, input.staleness));
    return buildTextResponse("production_review", t, lines);
  }

  if (policy.strength === "HIGH_CONFIDENCE") {
    lines.push(t("canIDeploy.yesLead"));
    lines.push("");
    lines.push(t("canIDeploy.yesComfort"));
    lines.push(t("canIDeploy.yesProtect"));
    lines.push(t("canIDeploy.yesCompany"));
  } else if (policy.strength === "SUPPORTED") {
    lines.push(t("canIDeploy.supportedLead"));
    lines.push("");
    lines.push(t("canIDeploy.supportedBody", { count: policy.notFullyEvaluatedAreaCount }));
  } else if (policy.strength === "QUALIFIED") {
    lines.push(t("canIDeploy.qualifiedLead"));
    lines.push("");
    lines.push(t("canIDeploy.qualifiedBody"));
  } else if (input.status === "ready_to_ship") {
    // Ready classification without current evidence (stale, in progress, failed).
    lines.push(t("canIDeploy.cantAnswerLead"));
    lines.push("");
    lines.push(t("canIDeploy.notCurrentBody"));
  } else if (input.status === "almost_ready") {
    lines.push(t("canIDeploy.notYetLead"));
    lines.push("");
    lines.push(t("canIDeploy.notYetComfort"));
    lines.push(t("canIDeploy.noCompany"));
  } else {
    lines.push(t("canIDeploy.noLead"));
    lines.push("");
    lines.push(t("canIDeploy.noComfort"));
    lines.push(t("canIDeploy.noProtect"));
    lines.push(t("canIDeploy.noCompany"));
  }

  // Persisted narratives (AI / security-decision overlay) may explain but
  // can never carry approval language the policy forbids.
  const guardedSummary = guardDecisionText(input.executiveSummary, policy, "");
  if (guardedSummary.trim()) {
    lines.push("");
    lines.push(truncateExplanation(guardedSummary));
  }

  // "Nothing critical is blocking" is reassurance: only when the policy allows it.
  const omitReassurance =
    input.worries.length === 0 && policy.strength !== "HIGH_CONFIDENCE" && input.status === "ready_to_ship";
  if (!omitReassurance) {
    lines.push("");
    lines.push(...worriesBlock(t, input.worries));
  }
  lines.push(...recommendedActionBlock(t, pickRecommendedAction(t, input)));
  lines.push(...stalenessFootnotes(t, input.staleness));

  return buildTextResponse("production_review", t, lines);
}

export function formatReviewNowResponse(
  t: McpTranslator,
  variant: "queued" | "processing" | "already_completed",
  projectName: string
): string {
  const mode: McpMode = "production_review_request";
  if (variant === "queued") {
    return buildTextResponse(mode, t, [
      t("reviewNow.queuedLead"),
      "",
      t("reviewNow.queuedTiming"),
      "",
      t("reviewNow.queuedNext"),
    ]);
  }
  if (variant === "processing") {
    return buildTextResponse(mode, t, [t("reviewNow.processingLead"), "", t("reviewNow.queuedNext")]);
  }
  return buildTextResponse(mode, t, [
    t("reviewNow.alreadyLead"),
    "",
    t("reviewNow.alreadyNext"),
    "",
    t("reviewNow.alreadyProject", { name: projectName }),
  ]);
}

export function formatSafeFixChooseBlockers(
  t: McpTranslator,
  blockers: Array<{ title: string; id: string }>
): string {
  return buildTextResponse("safe_fix", t, [
    t("safeFix.chooseLead"),
    "",
    ...blockers.map((b, i) => `${i + 1}. ${b.title}`),
    "",
    t("safeFix.chooseNext"),
  ]);
}

export function formatSafeFixNoBlockers(t: McpTranslator): string {
  return buildTextResponse("safe_fix", t, [t("safeFix.noBlockers")]);
}

export type SafeFixNoActionableReason =
  | "insufficient_evidence"
  | "review_in_progress"
  | "review_failed"
  | "stale_or_unverified"
  | "not_ready_without_specific_finding";

const SAFE_FIX_NO_ACTIONABLE_KEYS: Record<SafeFixNoActionableReason, string> = {
  insufficient_evidence: "safeFix.noActionable.insufficientEvidence",
  review_in_progress: "safeFix.noActionable.reviewInProgress",
  review_failed: "safeFix.noActionable.reviewFailed",
  stale_or_unverified: "safeFix.noActionable.staleOrUnverified",
  not_ready_without_specific_finding: "safeFix.noActionable.notReadyWithoutSpecificFinding",
};

export function formatSafeFixNoActionableFinding(
  t: McpTranslator,
  reason: SafeFixNoActionableReason
): string {
  return buildTextResponse("safe_fix", t, [t(SAFE_FIX_NO_ACTIONABLE_KEYS[reason])]);
}

export function formatSafeFixPromptReady(
  t: McpTranslator,
  input: {
    title: string;
    estimatedFixTime: string;
    prompt: string;
  }
): string {
  const lines = [
    input.title,
    "",
    t("safeFix.timeHint", { time: input.estimatedFixTime }),
    "",
    t("safeFix.copyIntoCursor"),
    "",
    "---",
    input.prompt,
    "---",
    "",
    t("safeFix.afterFixSayReviewAgain"),
  ];
  return buildTextResponse("safe_fix", t, lines);
}

/**
 * A trend comparison ("things look better") must never be the only signal an
 * agent receives: it always carries the current authoritative decision and
 * any in-flight/stale/failed review state, plus an explicit statement that
 * it is not a deploy answer.
 */
function whatChangedStateBlock(
  t: McpTranslator,
  currentState: {
    decision: DeploymentDecision;
    staleness: StalenessFootnotes;
  }
): string[] {
  const lines: string[] = [];
  if (currentState.decision === "do_not_deploy") {
    lines.push("", t("whatChanged.stateDoNotDeploy"));
  } else if (currentState.decision === "more_analysis_required") {
    lines.push("", t("whatChanged.stateMoreAnalysis"));
  }
  lines.push(...stalenessFootnotes(t, currentState.staleness));
  lines.push("", t("whatChanged.notADeployAnswer"));
  return lines;
}

export function formatWhatChangedResponse(
  t: McpTranslator,
  input: {
    hasPrevious: boolean;
    /** False when the latest authoritative review is not the review being compared. */
    comparisonAvailable?: boolean;
    scoreDelta: number | null;
    resolved: string[];
    detected: string[];
    recommendedAction: string;
    currentState: {
      decision: DeploymentDecision;
      staleness: StalenessFootnotes;
    };
  }
): string {
  if (input.comparisonAvailable === false) {
    return buildTextResponse("continuous_review", t, [
      t("whatChanged.comparisonUnavailable"),
      ...whatChangedStateBlock(t, input.currentState),
      ...recommendedActionBlock(t, input.recommendedAction || t("actions.applySafeFix")),
    ]);
  }

  if (!input.hasPrevious) {
    return buildTextResponse("continuous_review", t, [
      t("whatChanged.noPreviousReview"),
      ...whatChangedStateBlock(t, input.currentState),
      "",
      t("whatChanged.firstReviewNext"),
    ]);
  }

  const lines: string[] = [t("whatChanged.sinceLastReview")];

  if (input.scoreDelta != null && input.scoreDelta > 0) {
    lines.push("", t("whatChanged.improved"));
  } else if (input.scoreDelta != null && input.scoreDelta < 0) {
    lines.push("", t("whatChanged.needsAttention"));
  } else {
    lines.push("", t("whatChanged.steady"));
  }

  lines.push("");
  lines.push(t("whatChanged.improvedHeader"));
  if (input.resolved.length > 0) {
    input.resolved.forEach((title) => lines.push(`- ${title}`));
  } else {
    lines.push(`- ${t("whatChanged.nothingNotable")}`);
  }

  lines.push("");
  lines.push(t("whatChanged.worriesNowHeader"));
  if (input.detected.length > 0) {
    input.detected.forEach((title) => lines.push(`- ${title}`));
  } else {
    lines.push(`- ${t("whatChanged.nothingNew")}`);
  }

  lines.push(...whatChangedStateBlock(t, input.currentState));
  lines.push(...recommendedActionBlock(t, input.recommendedAction || t("actions.applySafeFix")));
  return buildTextResponse("continuous_review", t, lines);
}

export function formatProductionHistoryResponse(
  t: McpTranslator,
  input: {
    trendKey: string;
    recentSparkline: string;
    validReviews: number;
  }
): string {
  const trendLabel = t(`productionHistory.trend.${input.trendKey}`);
  return buildTextResponse("production_history", t, [
    trendLabel,
    "",
    t("productionHistory.recentSnapshot", { scores: input.recentSparkline }),
    "",
    t("productionHistory.askDeployForToday"),
  ]);
}

export function formatProductionHistoryEmpty(t: McpTranslator): string {
  return buildTextResponse("production_history", t, [t("productionHistory.noHistory")]);
}

export function formatDiscoverApplicationResponse(
  discovery: import("@/server/ai-red-team/discovery/types").DiscoveryReport,
  t: McpTranslator
): string {
  const techLines =
    discovery.detectedTechnologies.length > 0
      ? discovery.detectedTechnologies.slice(0, 12).map((tech) => `- ${tech.name} (${Math.round(tech.confidence * 100)}%)`)
      : [`- ${t("discoverApplication.noTechnologies")}`];

  const surfaceLines =
    discovery.potentialAttackSurface.length > 0
      ? discovery.potentialAttackSurface.slice(0, 10).map((area) => `- ${area.label}: ${area.rationale}`)
      : [`- ${t("discoverApplication.noAttackSurface")}`];

  return buildTextResponse("application_discovery", t, [
    discovery.projectSummary,
    "",
    t("discoverApplication.technologiesHeader"),
    ...techLines,
    "",
    t("discoverApplication.attackSurfaceHeader"),
    ...surfaceLines,
    "",
    t("discoverApplication.confidenceLine", {
      score: String(Math.round(discovery.confidenceScore * 100)),
      commit: discovery.commitSha.slice(0, 7),
    }),
    "",
    t("discoverApplication.nextStep"),
  ]);
}
