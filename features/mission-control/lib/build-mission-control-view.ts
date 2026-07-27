import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
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

function teamReason(id: MissionTeamId, sig: ReturnType<typeof signals>): MissionTeamReason {
  const base = MISSION_TEAMS.find((t) => t.id === id)!;
  const map: Record<MissionTeamId, { reason: string; confidence: MissionTeamReason["confidence"] }> = {
    browser: { reason: "Frontend application detected.", confidence: "high" },
    authentication: { reason: "Authentication provider detected.", confidence: sig.auth ? "high" : "medium" },
    api: { reason: "REST or API endpoints detected.", confidence: sig.api ? "high" : "medium" },
    authorization: { reason: "Access control or admin surface detected.", confidence: "medium" },
    business_logic: { reason: "Subscription or payment workflow detected.", confidence: sig.business ? "high" : "low" },
    llm: { reason: "OpenAI or AI SDK detected.", confidence: sig.llm ? "high" : "low" },
    adversarial: { reason: "High-risk AI attack surface identified.", confidence: "medium" },
  };
  const entry = map[id];
  return {
    teamId: id,
    teamName: base.name,
    reason: teamSelected(id, sig) ? entry.reason : "Not required for this project profile.",
    confidence: entry.confidence,
  };
}

function deriveTeamStatus(
  id: MissionTeamId,
  selected: boolean,
  input: MissionControlBuildInput,
  index: number,
  selectedCount: number
): MissionTeamCard {
  const name = MISSION_TEAMS.find((t) => t.id === id)!.name;
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
          ? "1–3 min"
          : executionOverride === "failed"
            ? "Failed"
            : executionOverride === "completed"
              ? teamMetrics && "findingsCount" in teamMetrics
                ? `${teamMetrics.findingsCount} finding(s)`
                : "Done"
              : executionOverride === "queued"
                ? "Queued"
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
      estimatedDurationLabel: status === "running" ? "1–3 min" : "Queued",
      progressPercent: status === "completed" ? 100 : status === "running" ? 55 : 0,
    };
  }

  return {
    id,
    name,
    status: "completed",
    estimatedDurationLabel: "Done",
    progressPercent: 100,
  };
}

export function mapVerdictDisplay(verdict: ProductionVerdictV1 | null): MissionVerdictDisplay {
  if (!verdict) return "INSUFFICIENT EVIDENCE";
  switch (verdict.status) {
    case "ready_to_ship":
      return "SAFE TO DEPLOY";
    case "almost_ready":
      return "DEPLOY WITH WARNINGS";
    case "insufficient_data":
    case "analysis_failed":
      return "INSUFFICIENT EVIDENCE";
    default:
      return "BLOCKED";
  }
}

function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function buildMissionControlView(input: MissionControlBuildInput): MissionControlView {
  const sig = signals(input);
  const selectedIds = MISSION_TEAMS.map((t) => t.id).filter((id) => teamSelected(id, sig));
  const teams = MISSION_TEAMS.map((t, index) =>
    deriveTeamStatus(t.id, teamSelected(t.id, sig), input, index, selectedIds.length)
  );
  const teamReasons = MISSION_TEAMS.map((t) => teamReason(t.id, sig)).filter((r) =>
    teamSelected(r.teamId, sig)
  );

  const progress =
    input.sessionProgress ??
    (input.scanInProgress ? 42 : input.verdict ? 100 : 8);
  const runningTeam = teams.find((t) => t.status === "running");
  const currentPhase =
    input.sessionPhase ??
    runningTeam?.name ??
    (input.scanInProgress ? "Discovery" : input.verdict ? "Production Verdict" : "Awaiting analysis");

  const headerStatus = input.scanInProgress
    ? "Analyzing"
    : input.verdict?.status === "ready_to_ship"
      ? "Ready"
      : input.verdict
        ? "Review"
        : "Idle";

  const top = input.verdict?.topPriorities[0];
  const objective = {
    title: top?.title ?? (input.verdict ? "Review Production Verdict" : "Run production analysis"),
    estimatedEffortLabel: top?.estimatedTimeLabel ?? "—",
    engineeringPlanStatus: top ? ("ready" as const) : ("none" as const),
    replayStatus: input.verdict?.status === "ready_to_ship" ? ("passed" as const) : ("pending" as const),
    primaryAction: top ? ("generate_fix" as const) : input.verdict ? ("view_details" as const) : ("analyze" as const),
    priorityId: top?.id,
  };

  const feed =
    input.feedFromDb.length > 0
      ? input.feedFromDb
      : defaultFeed(input);

  const verdictDisplay = mapVerdictDisplay(input.verdict);

  return {
    projectId: input.projectId,
    header: {
      missionTitle: "Secure Production Deployment",
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
      replayStatusLabel: objective.replayStatus === "passed" ? "Passed" : "Pending",
      engineeringPlanStatusLabel: objective.engineeringPlanStatus === "ready" ? "Ready" : "Pending",
      deploymentRecommendation:
        verdictDisplay === "SAFE TO DEPLOY"
          ? "Proceed when your release process allows."
          : verdictDisplay === "DEPLOY WITH WARNINGS"
            ? "Address top priorities before wide rollout."
            : "Do not deploy until blockers are resolved.",
      verdictStatus: input.verdict?.status ?? "insufficient_data",
      score: input.verdict?.score ?? 0,
    },
    detailsHref: input.verdict ? `/projects/${input.projectId}` : undefined,
    fixPromptContext: input.verdict
      ? {
          projectName: input.projectName,
          currentVerdictStatus: input.verdict.status,
          currentScore: input.verdict.score ?? 0,
        }
      : undefined,
  };
}

function defaultFeed(input: MissionControlBuildInput) {
  const items = [{ id: "1", message: "Mission Control initialized.", occurredAt: new Date().toISOString() }];
  if (input.scanInProgress) {
    items.unshift({
      id: "2",
      message: "Discovery in progress.",
      occurredAt: new Date().toISOString(),
    });
  }
  if (input.verdict) {
    items.unshift({
      id: "3",
      message: "Production Verdict updated.",
      occurredAt: input.verdict.generatedAt,
    });
  }
  return items;
}
