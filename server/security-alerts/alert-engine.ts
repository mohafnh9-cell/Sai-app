import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { labelFromStorage, type ProtectionStatusStorage } from "@/server/continuous-protection/types";
import { loadProtectionContext } from "@/server/continuous-protection/protection-context";
import { defaultSeverityForKind, severityProfile } from "./severity";
import type { AlertCandidate } from "./types";

const STATUS_RANK: Record<string, number> = {
  protected: 0,
  safe_with_caution: 1,
  requires_attention: 2,
  not_protected: 3,
};

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000);
}

function statusWorsened(from: ProtectionStatusStorage | null, to: ProtectionStatusStorage): boolean {
  if (!from) return false;
  return (STATUS_RANK[to] ?? 0) > (STATUS_RANK[from] ?? 0);
}

function candidateBase(
  partial: Omit<AlertCandidate, "priority" | "protectionImpact" | "worryLine" | "nextAction"> &
    Partial<Pick<AlertCandidate, "priority" | "protectionImpact" | "worryLine" | "nextAction">>
): AlertCandidate {
  const severity = partial.severity;
  const profile = severityProfile(severity);
  return {
    ...partial,
    priority: partial.priority ?? profile.priority,
    protectionImpact: partial.protectionImpact ?? profile.protectionImpact,
    worryLine: partial.worryLine ?? profile.founderWorryLine,
    nextAction: partial.nextAction ?? profile.founderAction,
  };
}

export type EvaluationContext = {
  projectName: string;
  events24h: Array<{ type: string; payload: Record<string, unknown>; occurred_at: string }>;
  snapshots48h: Array<{
    snapshot_date: string;
    production_confidence: number | null;
    security_confidence: number | null;
    protection_status: string;
  }>;
  statusEvents7d: Array<{ payload: Record<string, unknown> }>;
};

export async function loadAlertEvaluationContext(
  admin: SupabaseClient,
  projectId: string
): Promise<EvaluationContext | null> {
  const { data: project } = await admin
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: events }, { data: snapshots }, { data: statusEvents }] = await Promise.all([
    admin
      .from("protection_events")
      .select("type, payload, occurred_at")
      .eq("project_id", projectId)
      .gte("occurred_at", since24)
      .order("occurred_at", { ascending: false })
      .limit(50),
    admin
      .from("protection_snapshots")
      .select("snapshot_date, production_confidence, security_confidence, protection_status")
      .eq("project_id", projectId)
      .order("snapshot_date", { ascending: false })
      .limit(3),
    admin
      .from("protection_events")
      .select("payload")
      .eq("project_id", projectId)
      .eq("type", "protection_status_updated")
      .gte("occurred_at", since7d)
      .order("occurred_at", { ascending: false })
      .limit(10),
  ]);

  return {
    projectName: project.name as string,
    events24h: (events ?? []).map((e) => ({
      type: e.type as string,
      payload: (e.payload as Record<string, unknown>) ?? {},
      occurred_at: e.occurred_at as string,
    })),
    snapshots48h: (snapshots ?? []).map((s) => ({
      snapshot_date: s.snapshot_date as string,
      production_confidence: s.production_confidence as number | null,
      security_confidence: s.security_confidence as number | null,
      protection_status: s.protection_status as string,
    })),
    statusEvents7d: (statusEvents ?? []).map((e) => ({
      payload: (e.payload as Record<string, unknown>) ?? {},
    })),
  };
}

/** Build alert candidates from CP + verdict signals (no new scanners). */
export function buildProtectionAlertCandidates(
  ctx: Awaited<ReturnType<typeof loadProtectionContext>>,
  evalCtx: EvaluationContext
): AlertCandidate[] {
  if (!ctx) return [];
  const candidates: AlertCandidate[] = [];
  const day = dayKey();
  const hasMaterialEvent24h = evalCtx.events24h.some((e) =>
    ["material_change_detected", "dependency_snapshot", "protection_status_updated"].includes(e.type)
  );

  const latest = evalCtx.snapshots48h[0];
  const previous = evalCtx.snapshots48h[1];
  const prodDrop =
    latest?.production_confidence != null && previous?.production_confidence != null
      ? previous.production_confidence - latest.production_confidence
      : null;
  const secDrop =
    latest?.security_confidence != null && previous?.security_confidence != null
      ? previous.security_confidence - latest.security_confidence
      : null;

  if (prodDrop != null && prodDrop >= 10 && hoursSince(latest ? `${latest.snapshot_date}T12:00:00Z` : new Date().toISOString()) <= 48) {
    candidates.push(
      candidateBase({
        alertKind: "confidence_cliff",
        severity: defaultSeverityForKind("confidence_cliff"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:conf_cliff:${day}`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: [`Production confidence dropped ${prodDrop} points.`],
        ctaType: "safe_fix",
      })
    );
  } else if (prodDrop != null && prodDrop >= 5) {
    candidates.push(
      candidateBase({
        alertKind: "production_confidence_drop",
        severity: defaultSeverityForKind("production_confidence_drop"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:prod_conf:${day}`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: [`Production confidence ${previous?.production_confidence}% → ${latest?.production_confidence}%.`],
        ctaType: "review_again",
      })
    );
  }

  if (secDrop != null && secDrop >= 5) {
    candidates.push(
      candidateBase({
        alertKind: "security_confidence_drop",
        severity: defaultSeverityForKind("security_confidence_drop"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:sec_conf:${day}`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: [`Security confidence ${previous?.security_confidence}% → ${latest?.security_confidence}%.`],
        ctaType: "review_again",
      })
    );
  }

  for (const event of evalCtx.statusEvents7d) {
    const from = event.payload.from as ProtectionStatusStorage | undefined;
    const to = event.payload.to as ProtectionStatusStorage | undefined;
    if (from && to && statusWorsened(from, to)) {
      const fromLabel = labelFromStorage(from);
      const toLabel = labelFromStorage(to);
      candidates.push(
        candidateBase({
          alertKind: "protection_status_regression",
          severity: defaultSeverityForKind("protection_status_regression"),
          deliveryTier: "immediate",
          dedupeKey: `${ctx.projectId}:status:${from}:${to}:${day}`,
          titlePlain: "",
          bodyPlain: "",
          changedBullets: [
            `Protection status moved from ${fromLabel.replace(/_/g, " ")} to ${toLabel.replace(/_/g, " ")}.`,
            ...(ctx.worries.slice(0, 2).map((w) => w) ?? []),
          ],
          ctaType: to === "requires_attention" ? "safe_fix" : "review_again",
        })
      );
      break;
    }
  }

  if (ctx.openCritical > 0 && hasMaterialEvent24h) {
    candidates.push(
      candidateBase({
        alertKind: "material_finding_critical",
        severity: defaultSeverityForKind("material_finding_critical"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:critical:${day}`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: ctx.worries.slice(0, 3),
        ctaType: "safe_fix",
        linkedRecommendationId: ctx.verdict?.topPriorities[0]?.id ?? null,
      })
    );
  } else if (ctx.openHigh > 0 && hasMaterialEvent24h && ctx.deployAnswer === "not_yet") {
    candidates.push(
      candidateBase({
        alertKind: "material_finding_high",
        severity: defaultSeverityForKind("material_finding_high"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:high:${day}`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: ctx.worries.slice(0, 3),
        ctaType: "safe_fix",
      })
    );
  }

  const depEvent = evalCtx.events24h.find((e) => e.type === "dependency_snapshot" && e.payload.changed === true);
  if (depEvent) {
    candidates.push(
      candidateBase({
        alertKind: "dependency_critical_new",
        severity: defaultSeverityForKind("dependency_critical_new"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:dep:${depEvent.payload.lockfileHash ?? day}`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: ["Dependencies changed on the default branch."],
        ctaType: "review_again",
      })
    );
  }

  if (!ctx.githubConnected && ctx.cpEnabled) {
    candidates.push(
      candidateBase({
        alertKind: "github_disconnected",
        severity: defaultSeverityForKind("github_disconnected"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:github_disconnected`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: ["GitHub is disconnected — I cannot watch new commits."],
        ctaType: "reconnect_github",
        cooldownHours: 168,
      })
    );
  }

  if (ctx.cpPaused) {
    candidates.push(
      candidateBase({
        alertKind: "protection_paused",
        severity: defaultSeverityForKind("protection_paused"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:paused`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: ["Continuous protection is paused."],
        ctaType: "resume_cp",
        cooldownHours: 168,
      })
    );
  }

  if (ctx.consecutiveDailyFailures >= 3) {
    candidates.push(
      candidateBase({
        alertKind: "check_delayed",
        severity: defaultSeverityForKind("check_delayed"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:check_delayed:${day}`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: ["Daily protection checks failed repeatedly."],
        ctaType: "review_again",
      })
    );
  }

  const lastCheck = ctx.lastCheckAt ? hoursSince(ctx.lastCheckAt) / 24 : null;
  if (ctx.cpEnabled && !ctx.cpPaused && lastCheck != null && lastCheck > 14) {
    candidates.push(
      candidateBase({
        alertKind: "watch_stale",
        severity: defaultSeverityForKind("watch_stale"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:watch_stale:${day}`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: [`No successful protection check in ${Math.floor(lastCheck)} days.`],
        ctaType: "review_again",
      })
    );
  }

  if (ctx.deployAnswer === "no_go" && ctx.openCritical > 0) {
    candidates.push(
      candidateBase({
        alertKind: "unsafe_deployment_detected",
        severity: defaultSeverityForKind("unsafe_deployment_detected"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:unsafe:${day}`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: ctx.worries.slice(0, 2),
        ctaType: "safe_fix",
      })
    );
  }

  if (ctx.openCritical > 0 && ctx.worries[0]) {
    candidates.push(
      candidateBase({
        alertKind: "critical_recommendation_detected",
        severity: defaultSeverityForKind("critical_recommendation_detected"),
        deliveryTier: "immediate",
        dedupeKey: `${ctx.projectId}:rec_critical:${ctx.worries[0].slice(0, 40)}:${day}`,
        titlePlain: "",
        bodyPlain: "",
        changedBullets: [ctx.worries[0]],
        ctaType: "safe_fix",
        linkedRecommendationId: ctx.verdict?.topPriorities[0]?.id ?? null,
      })
    );
  }

  return candidates;
}

export function buildDeployBlockedCandidate(
  projectId: string,
  projectName: string,
  primaryWorry: string | null
): AlertCandidate {
  const day = dayKey();
  return candidateBase({
    alertKind: "deploy_blocked",
    severity: defaultSeverityForKind("deploy_blocked"),
    deliveryTier: "digest",
    dedupeKey: `${projectId}:deploy_blocked:${day}`,
    titlePlain: `Deploy check — ${projectName}`,
    bodyPlain: "",
    changedBullets: primaryWorry ? [primaryWorry] : ["SequrAI is not comfortable with a deploy right now."],
    ctaType: "safe_fix",
    nextAction: "Apply Safe Fix before you ship.",
  });
}
