import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { emitOperationalEvent } from "@/server/observability/operational-events";
import {
  buildIdempotencyKey,
  runIdempotentSideEffect,
} from "@/server/observability/idempotency";

export type NotificationType =
  | "critical_finding"
  | "score_decreased"
  | "scan_completed"
  | "vulnerabilities_fixed"
  | "pull_request_analyzed"
  | "recommendation";

export async function createSecurityNotification(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId?: string;
    userId?: string;
    channel?: "in_app" | "email" | "slack" | "discord";
    notificationType: NotificationType;
    title: string;
    body: string;
    severity?: "info" | "warning" | "critical";
    metadata?: Record<string, unknown>;
    scanId?: string;
    commitSha?: string | null;
  }
) {
  const channel = input.channel ?? "in_app";
  const operationType = channel === "email" ? "email_notification" : "in_app_notification";
  const idempotencyKey = buildIdempotencyKey({
    organizationId: input.organizationId,
    projectId: input.projectId ?? input.organizationId,
    scanId: input.scanId ?? input.projectId ?? input.organizationId,
    commitSha: input.commitSha ?? null,
    operationType,
    suffix: `${input.notificationType}:${input.userId ?? "org"}:${input.title}`,
  });

  const result = await runIdempotentSideEffect(
    admin,
    {
      idempotencyKey,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      scanId: input.scanId ?? null,
      operationType,
    },
    async () => {
      await admin.from("security_notifications").insert({
        organization_id: input.organizationId,
        project_id: input.projectId ?? null,
        user_id: input.userId ?? null,
        channel,
        notification_type: input.notificationType,
        title: input.title,
        body: input.body,
        severity: input.severity ?? "info",
        metadata: input.metadata ?? {},
      });
    }
  );

  if (result.duplicate) return;
  if (!result.executed) return;

  await emitOperationalEvent(admin, {
    eventType: "notification_sent",
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
    scanId: input.scanId ?? null,
    metadata: { notificationType: input.notificationType, channel },
  });
}

export async function notifyOrganizationMembers(
  admin: SupabaseClient,
  organizationId: string,
  input: Omit<Parameters<typeof createSecurityNotification>[1], "organizationId" | "userId">
) {
  const { data: members } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId);
  const targets = members?.length ? members : [{ user_id: null }];
  for (const member of targets) {
    try {
      await createSecurityNotification(admin, {
        ...input,
        organizationId,
        userId: member.user_id ?? undefined,
      });
    } catch (error) {
      await emitOperationalEvent(admin, {
        eventType: "notification_failed",
        organizationId,
        projectId: input.projectId ?? null,
        scanId: input.scanId ?? null,
        failureCode: "NOTIFICATION_FAILED",
        metadata: {
          message: error instanceof Error ? error.message : "unknown",
          notificationType: input.notificationType,
        },
      });
    }
  }
}
