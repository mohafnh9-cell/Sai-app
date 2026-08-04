import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { Translator } from "@/lib/i18n/types";
import { namespaceTranslator } from "@/lib/i18n/review-progress";
import type { AppLocale } from "@/lib/i18n/types";
import {
  MISSION_TEAMS,
  type MissionControlBuildInput,
  type MissionControlView,
  type MissionTeamCard,
  type MissionTeamId,
  type MissionTeamReason,
  type MissionTeamStatus,
  type MissionVerdictDisplay,
} from "../types";

function stackText(stack?: Record<string, unknown> | null): string {
  if (!stack) return "";
  return JSON.stringify(stack).toLowerCase();
}

function signals(input: MissionControlBuildInput) {
  const text = stackText(input.detectedStack);
  return {
    frontend: /next|react|vue|svelte|frontend|browser/.test(text) || true,
    auth: /clerk|auth\.js|next-auth|supabase|authentication/.test(text),
    api: /api|rest|graphql|trpc|express/.test(text),
    authz: /rbac|authorization|admin|tenant/.test(text) || input.verdict != null,
    business: /stripe|subscription|payment|billing|workflow/.test(text),
    llm: /openai|anthropic|langchain|llm|ai-sdk/.test(text),
    adversarial: /openai|llm|mcp|ai/.test(text),
  };
}

function teamSelected(id: MissionTeamId, sig: ReturnType<typeof signals>): boolean {
  switch (id) {
    case "browser":
      return sig.frontend;
    case "authentication":
      return sig.auth;
    case "api":
      return sig.api;
    case "authorization":
      return sig.authz;
    case "business_logic":
      return sig.business;
    case "llm":
      return sig.llm;
    case "adversarial":
      return sig.adversarial && (sig.llm || /mcp/.test(stackText()));
    default:
      return false;
  }
}

function teamReason(id: MissionTeamId, sig: ReturnType<typeof signals>, t: Translator): MissionTeamReason {
  const teamKey = id as string;
  const map: Record<MissionTeamId, { reasonKey: string; confidence: MissionTeamReason["confidence"] }> = {
    browser: { reasonKey: "teams.reasons.browser", confidence: "high" },
    authentication: { reasonKey: "teams.reasons.authentication", confidence: sig.auth ? "high" : "medium" },
    api: { reasonKey: "teams.reasons.api", confidence: sig.api ? "high" : "medium" },
    authorization: { reasonKey: "teams.reasons.authorization", confidence: "medium" },
    business_logic: { reasonKey: "teams.reasons.business_logic", confidence: sig.business ? "high" : "low" },
    llm: { reasonKey: "teams.reasons.llm", confidence: sig.llm ? "high" : "low" },
    adversarial: { reasonKey: "teams.reasons.adversarial", confidence: "medium" },
  };
  const entry = map[id];
  return {
    teamId: id,
    teamName: t(`teams.${teamKey}`),
    reason: teamSelected(id, sig) ? t(entry.reasonKey) : t("teams.reasons.notRequired"),
    confidence: entry.confidence,
  };
}

function deriveTeamStatus(
  id: MissionTeamId,
  selected: boolean,
  input: MissionControlBuildInput,
  index: number,
  selectedCount: number,
  t: Translator
): MissionTeamCard {
  const name = t(`teams.${id}`);
  const executionOverride = input.teamExecution?.[id];

  if (!selected) {
    return {
      id,
      name,
      status: executionOverride ?? "skipped",
      estimatedDurationLabel: "—",
      progressPercent: 0,
    };
  }

  if (executionOverride) {
    const blMetrics = id === "business_logic" ? input.businessLogicMetrics : undefined;
    const llmMetrics = id === "llm" ? input.llmMetrics : undefined;
    const teamMetrics = blMetrics ?? llmMetrics;
    const progressFromMetrics =
      teamMetrics && teamMetrics.coveragePercent != null
        ? Math.min(100, Math.max(0, teamMetrics.coveragePercent))
        : executionOverride === "completed"
          ? 100
          : executionOverride === "running"
            ? 55
            : executionOverride === "failed"
              ? 100
              : 0;
    return {
      id,
      name,
      status: executionOverride,
      estimatedDurationLabel:
        executionOverride === "running"
          ? t("teams.duration.estimate")
          : executionOverride === "failed"
            ? t("status.failed")
            : executionOverride === "completed"
              ? teamMetrics && "findingsCount" in teamMetrics
                ? t("teams.duration.findings", { count: teamMetrics.findingsCount })
                : t("status.done")
              : executionOverride === "queued"
                ? t("status.queued")
                : "—",
      progressPercent: progressFromMetrics,
    };
  }

  if (input.scanInProgress) {
    const progress = input.sessionProgress ?? Math.min(95, 20 + index * 12);
    const runningIndex = Math.floor((progress / 100) * selectedCount);
    let status: MissionTeamStatus = "queued";
    if (index < runningIndex) status = "completed";
    else if (index === runningIndex) status = "running";
    return {
      id,
      name,
      status,
      estimatedDurationLabel: status === "running" ? t("teams.duration.estimate") : t("status.queued"),
      progressPercent: status === "completed" ? 100 : status === "running" ? 55 : 0,
    };
  }

  return {
    id,
    name,
    status: "completed",
    estimatedDurationLabel: t("status.done"),
    progressPercent: 100,
  };
}

export function mapVerdictDisplay(verdict: ProductionVerdictV1 | null, t: Translator): MissionVerdictDisplay {
  if (!verdict) return t("verdict.display.insufficientEvidence") as MissionVerdictDisplay;
  switch (verdict.status) {
    case "ready_to_ship":
      return t("verdict.display.safeToDeploy") as MissionVerdictDisplay;
    case "almost_ready":
      return t("verdict.display.deployWithWarnings") as MissionVerdictDisplay;
    case "insufficient_data":
    case "analysis_failed":
      return t("verdict.display.insufficientEvidence") as MissionVerdictDisplay;
    default:
      return t("verdict.display.blocked") as MissionVerdictDisplay;
  }
}

function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function buildMissionControlView(
  input: MissionControlBuildInput,
  locale: AppLocale = "en"
): MissionControlView {
  const t = input.t ?? namespaceTranslator(locale, "missionControl");
  const sig = signals(input);
  const selectedIds = MISSION_TEAMS.map((team) => team.id).filter((id) => teamSelected(id, sig));
  const teams = MISSION_TEAMS.map((team, index) =>
    deriveTeamStatus(team.id, teamSelected(team.id, sig), input, index, selectedIds.length, t)
  );
  const teamReasons = MISSION_TEAMS.map((team) => teamReason(team.id, sig, t)).filter((r) =>
    teamSelected(r.teamId, sig)
  );

  const progress =
    input.cancelledReview?.progressAtCancellation ??
    input.sessionProgress ??
    (input.scanInProgress ? 42 : input.verdict ? 100 : 8);
  const runningTeam = teams.find((t) => t.status === "running");
  const currentPhase =
    input.cancelledReview?.lastCompletedPhase ??
    input.sessionPhase ??
    runningTeam?.name ??
    (input.scanInProgress ? t("phases.discovery") : input.verdict ? t("phases.productionVerdict") : t("phases.awaitingAnalysis"));

  const headerStatus = input.cancelledReview
    ? t("status.cancelled")
    : input.scanInProgress
      ? t("status.analyzing")
      : input.verdict?.status === "ready_to_ship"
        ? t("status.ready")
        : input.verdict
          ? t("status.review")
          : t("status.idle");

  const top = input.verdict?.topPriorities[0];
  const objective = {
    title:
      top?.title ??
      input.verdict?.recommendedAction ??
      (input.verdict ? t("objective.reviewVerdict") : t("objective.runAnalysis")),
    estimatedEffortLabel: top?.estimatedTimeLabel ?? "—",
    engineeringPlanStatus: top ? ("ready" as const) : ("none" as const),
    replayStatus: input.verdict?.status === "ready_to_ship" ? ("passed" as const) : ("pending" as const),
    primaryAction: top ? ("generate_fix" as const) : input.verdict ? ("view_details" as const) : ("analyze" as const),
    priorityId: top?.id,
  };

  const feed =
    input.feedFromDb.length > 0
      ? input.feedFromDb
      : defaultFeed(input, t);

  const verdictDisplay = mapVerdictDisplay(input.verdict, t);

  const hideProductionVerdict = Boolean(input.cancelledReview);

  return {
    projectId: input.projectId,
    header: {
      missionTitle: t("header.missionTitle"),
      projectName: input.projectName,
      statusLabel: headerStatus,
      progressPercent: progress,
      etaLabel: input.scanInProgress ? formatEta(input.sessionEtaSeconds ?? 102) : "—",
      currentPhase: currentPhase.replace(" Team", " Analysis"),
    },
    teams,
    teamReasons,
    feed,
    objective,
    verdict: {
      display: verdictDisplay,
      confidence: input.verdict?.confidence ?? "medium",
      criticalCampaigns: input.verdict?.topPriorities.filter((p) => p.severity === "critical").length ?? 0,
      replayStatusLabel:
        objective.replayStatus === "passed"
          ? t("verdict.replayStatus.passed")
          : t("verdict.replayStatus.pending"),
      engineeringPlanStatusLabel:
        objective.engineeringPlanStatus === "ready"
          ? t("verdict.engineeringPlanStatus.ready")
          : t("verdict.engineeringPlanStatus.pending"),
      deploymentRecommendation:
        verdictDisplay === t("verdict.display.safeToDeploy")
          ? t("verdict.deploymentRecommendation.safe")
          : verdictDisplay === t("verdict.display.deployWithWarnings")
            ? t("verdict.deploymentRecommendation.warnings")
            : t("verdict.deploymentRecommendation.blocked"),
      verdictStatus: input.verdict?.status ?? "insufficient_data",
      score: input.verdict?.score ?? null,
    },
    detailsHref: input.verdict ? `/projects/${input.projectId}` : undefined,
    fixPromptContext: input.verdict
      ? {
          projectName: input.projectName,
          currentVerdictStatus: input.verdict.status,
          currentScore: input.verdict.score ?? 0,
        }
      : undefined,
    cancelledReview: input.cancelledReview ?? null,
    hideProductionVerdict,
  };
}

function defaultFeed(input: MissionControlBuildInput, t: Translator) {
  const items = [{ id: "1", message: t("feed.initialized"), occurredAt: new Date().toISOString() }];
  if (input.scanInProgress) {
    items.unshift({
      id: "2",
      message: t("feed.discoveryInProgress"),
      occurredAt: new Date().toISOString(),
    });
  }
  if (input.verdict) {
    items.unshift({
      id: "3",
      message: t("feed.verdictUpdated"),
      occurredAt: input.verdict.generatedAt,
    });
  }
  return items;
}
