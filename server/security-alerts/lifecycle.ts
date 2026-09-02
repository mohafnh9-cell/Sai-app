import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { appendAlertSentMemory, buildAlertCopy } from "./memory-bridge";
import {
  cooldownUntil,
  duplicateSuppressionReason,
  isWithinCooldown,
  shouldDeliverAlert,
} from "./noise-policy";
import { severityProfile } from "./severity";
import { notifyOwnerOfCriticalAlert } from "./notify-owner";
import type { AlertCandidate, AlertState, FounderAlertRecord } from "./types";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "security-alerts", event, ...fields });
}

async function appendLifecycleEvent(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    alertId: string;
    eventType: string;
    fromState?: AlertState | null;
    toState?: AlertState | null;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await admin.from("security_alert_events").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    alert_id: input.alertId,
    event_type: input.eventType,
    from_state: input.fromState ?? null,
    to_state: input.toState ?? null,
    payload: input.payload ?? {},
  });
  if (error && !error.message.includes("does not exist")) {
    log("lifecycle_event_failed", { error: error.message });
  }
}

export async function deliverAlertCandidate(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    projectName: string;
    candidate: AlertCandidate;
  }
): Promise<{ delivered: boolean; reason?: string; alertId?: string }> {
  if (!shouldDeliverAlert(input.candidate)) {
    return { delivered: false, reason: "severity_or_tier_suppressed" };
  }

  const { data: existing } = await admin
    .from("security_alerts")
    .select("id, cooldown_until, state")
    .eq("project_id", input.projectId)
    .eq("dedupe_key", input.candidate.dedupeKey)
    .maybeSingle();

  if (existing) {
    return { delivered: false, reason: "duplicate_dedupe_key", alertId: existing.id as string };
  }

  const { data: recentSameKind } = await admin
    .from("security_alerts")
    .select("cooldown_until")
    .eq("project_id", input.projectId)
    .eq("alert_kind", input.candidate.alertKind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (isWithinCooldown((recentSameKind?.cooldown_until as string) ?? null)) {
    const suppress = duplicateSuppressionReason(false, true);
    return { delivered: false, reason: suppress ?? "cooldown_active" };
  }

  const profile = severityProfile(input.candidate.severity);
  const copy = buildAlertCopy(input.projectName, input.candidate);
  const cooldown = cooldownUntil(input.candidate);

  const { data: row, error } = await admin
    .from("security_alerts")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      alert_kind: input.candidate.alertKind,
      severity: input.candidate.severity,
      delivery_tier: input.candidate.deliveryTier,
      state: "delivered",
      dedupe_key: input.candidate.dedupeKey,
      cooldown_until: cooldown?.toISOString() ?? null,
      priority: input.candidate.priority || profile.priority,
      protection_impact: input.candidate.protectionImpact || profile.protectionImpact,
      title_plain: input.candidate.titlePlain || copy.titlePlain,
      body_plain: input.candidate.bodyPlain || copy.bodyPlain,
      worry_line: input.candidate.worryLine || profile.founderWorryLine,
      changed_bullets: input.candidate.changedBullets,
      next_action: input.candidate.nextAction || profile.founderAction,
      cta_type: input.candidate.ctaType,
      linked_recommendation_id: input.candidate.linkedRecommendationId ?? null,
      source: "evaluator",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { delivered: false, reason: "duplicate_dedupe_key" };
    log("deliver_failed", { projectId: input.projectId, error: error.message });
    return { delivered: false, reason: "insert_failed" };
  }

  const alertId = row.id as string;
  await appendLifecycleEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    alertId,
    eventType: "created",
    toState: "delivered",
    payload: { alertKind: input.candidate.alertKind },
  });

  await appendAlertSentMemory(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    alertId,
    alertKind: input.candidate.alertKind,
    dedupeKey: input.candidate.dedupeKey,
    severity: input.candidate.severity,
  });

  // M7 (audit): awaited, not detached -- notifyOwnerOfCriticalAlert already
  // catches every error internally and never throws, so this can't fail
  // alert delivery; awaiting it just means the caller (an Inngest step, not
  // a request handler racing a response) doesn't return before the email
  // attempt actually finishes, avoiding the same fire-and-forget class of
  // bug M6 found elsewhere in this codebase. Idempotent by construction:
  // this line only runs once per dedupe_key (see the early-return above).
  if (input.candidate.severity === "critical") {
    await notifyOwnerOfCriticalAlert(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      projectName: input.projectName,
      alertId,
      titlePlain: input.candidate.titlePlain || copy.titlePlain,
    });
  }

  return { delivered: true, alertId };
}

export async function markAlertRead(
  admin: SupabaseClient,
  alertId: string,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { data: alert } = await admin
    .from("security_alerts")
    .select("id, project_id, organization_id, state")
    .eq("id", alertId)
    .maybeSingle();
  if (!alert || alert.state === "dismissed" || alert.state === "resolved") return;

  await admin
    .from("security_alerts")
    .update({ state: "read", read_at: now })
    .eq("id", alertId);

  await appendLifecycleEvent(admin, {
    organizationId: alert.organization_id as string,
    projectId: alert.project_id as string,
    alertId,
    eventType: "read",
    fromState: alert.state as AlertState,
    toState: "read",
    payload: { userId },
  });
}

export async function acknowledgeAlert(
  admin: SupabaseClient,
  alertId: string,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { data: alert } = await admin
    .from("security_alerts")
    .select("id, project_id, organization_id, state")
    .eq("id", alertId)
    .maybeSingle();
  if (!alert) return;

  await admin
    .from("security_alerts")
    .update({ acknowledged_at: now, state: alert.state === "delivered" ? "read" : alert.state, read_at: now })
    .eq("id", alertId);

  await appendLifecycleEvent(admin, {
    organizationId: alert.organization_id as string,
    projectId: alert.project_id as string,
    alertId,
    eventType: "acknowledged",
    payload: { userId },
  });
}

export async function dismissAlert(
  admin: SupabaseClient,
  alertId: string,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { data: alert } = await admin
    .from("security_alerts")
    .select("id, project_id, organization_id, state")
    .eq("id", alertId)
    .maybeSingle();
  if (!alert) return;

  await admin
    .from("security_alerts")
    .update({ state: "dismissed", dismissed_at: now })
    .eq("id", alertId);

  await appendLifecycleEvent(admin, {
    organizationId: alert.organization_id as string,
    projectId: alert.project_id as string,
    alertId,
    eventType: "dismissed",
    fromState: alert.state as AlertState,
    toState: "dismissed",
    payload: { userId },
  });
}

export async function autoResolveAlertsForProject(
  admin: SupabaseClient,
  projectId: string,
  reason: string
): Promise<number> {
  const now = new Date().toISOString();
  const { data: open } = await admin
    .from("security_alerts")
    .select("id, organization_id, state")
    .eq("project_id", projectId)
    .in("state", ["delivered", "read"]);

  if (!open?.length) return 0;

  for (const row of open) {
    await admin
      .from("security_alerts")
      .update({ state: "resolved", resolved_at: now })
      .eq("id", row.id);
    await appendLifecycleEvent(admin, {
      organizationId: row.organization_id as string,
      projectId,
      alertId: row.id as string,
      eventType: "resolved",
      fromState: row.state as AlertState,
      toState: "resolved",
      payload: { reason },
    });
  }
  return open.length;
}

export function mapAlertRow(row: Record<string, unknown>): FounderAlertRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    alertKind: row.alert_kind as FounderAlertRecord["alertKind"],
    severity: row.severity as FounderAlertRecord["severity"],
    deliveryTier: row.delivery_tier as FounderAlertRecord["deliveryTier"],
    state: row.state as FounderAlertRecord["state"],
    titlePlain: row.title_plain as string,
    bodyPlain: row.body_plain as string,
    worryLine: row.worry_line as string,
    changedBullets: (row.changed_bullets as string[]) ?? [],
    nextAction: row.next_action as string,
    ctaType: (row.cta_type as FounderAlertRecord["ctaType"]) ?? null,
    protectionImpact: row.protection_impact as string,
    createdAt: row.created_at as string,
    readAt: (row.read_at as string) ?? null,
    acknowledgedAt: (row.acknowledged_at as string) ?? null,
  };
}
