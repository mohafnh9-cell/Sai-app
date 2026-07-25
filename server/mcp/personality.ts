import "server-only";

import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { DeploymentDecision } from "./decision-mapping";
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
  }
): string {
  if (input.staleness.reviewInProgress) return t("actions.waitForReview");
  if (input.staleness.freshnessStatus === "stale" || input.staleness.reviewFailed) {
    return t("actions.reviewAgain");
  }
  if (input.status === "insufficient_data" || input.status === "analysis_failed") {
    return t("actions.runFirstReview");
  }
  if (input.decision === "deploy") return t("actions.shipWhenReady");
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
  }
): string {
  const lines: string[] = [];

  if (input.status === "insufficient_data") {
    lines.push(t("canIDeploy.cantAnswerLead"));
    lines.push("");
    lines.push(t("canIDeploy.cantAnswerComfort"));
    lines.push("");
    lines.push(truncateExplanation(input.executiveSummary || t("canIDeploy.insufficientData")));
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

  if (input.decision === "deploy") {
    lines.push(t("canIDeploy.yesLead"));
    lines.push("");
    lines.push(t("canIDeploy.yesComfort"));
    lines.push(t("canIDeploy.yesProtect"));
    lines.push(t("canIDeploy.yesCompany"));
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

  if (input.executiveSummary.trim()) {
    lines.push("");
    lines.push(truncateExplanation(input.executiveSummary));
  }

  lines.push("");
  lines.push(...worriesBlock(t, input.worries));
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

export function formatWhatChangedResponse(
  t: McpTranslator,
  input: {
    hasPrevious: boolean;
    scoreDelta: number | null;
    resolved: string[];
    detected: string[];
    recommendedAction: string;
  }
): string {
  if (!input.hasPrevious) {
    return buildTextResponse("continuous_review", t, [
      t("whatChanged.noPreviousReview"),
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
