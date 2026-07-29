import { z } from "zod";
import type { ScanRunPayload, WebhookProcessPayload } from "./types";

const FORBIDDEN_INNGEST_KEYS = [
  "providerToken",
  "token",
  "secret",
  "password",
  "authorization",
  "payload",
  "webhookPayload",
  "rawBody",
] as const;

export const scanRunInngestEventSchema = z.object({
  scanJobId: z.string().uuid(),
  scanId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().min(1),
  jobType: z
    .enum([
      "webhook_process",
      "manual_scan",
      "mcp_review",
      "webhook_push_scan",
      "webhook_pr_scan",
      "automatic_review",
    ])
    .optional(),
  scanType: z.enum(["full", "incremental"]).optional(),
  branch: z.string().optional(),
  baseCommitSha: z.string().optional(),
  headCommitSha: z.string().min(7).optional(),
  correlationId: z.string().uuid().optional(),
  persistMode: z.enum(["full", "review_only"]).optional(),
});

export type ScanRunInngestEvent = z.infer<typeof scanRunInngestEventSchema>;

export function assertSafeInngestScanRunPayload(payload: ScanRunPayload): void {
  for (const key of FORBIDDEN_INNGEST_KEYS) {
    if (key in (payload as Record<string, unknown>)) {
      throw new Error(`Inngest scan/run payload must not include ${key}`);
    }
  }
}

export function parseScanRunInngestEvent(data: unknown): ScanRunInngestEvent {
  const parsed = scanRunInngestEventSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid scan/run Inngest payload: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function buildInngestScanRunPayload(payload: ScanRunPayload): ScanRunPayload {
  assertSafeInngestScanRunPayload(payload);
  const built: ScanRunPayload = {
    ...payload,
    projectId: payload.projectId,
    headCommitSha: payload.headCommitSha,
    branch: payload.branch,
  };
  parseScanRunInngestEvent(built);
  return built;
}

export type SafeWebhookProcessPayload = {
  scanJobId: string;
};

export function buildInngestWebhookProcessPayload(scanJobId: string): SafeWebhookProcessPayload {
  return { scanJobId };
}

export function extractWebhookMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const repository = payload.repository as
    | { id?: number; full_name?: string; name?: string }
    | undefined;
  const headCommit = (payload.head_commit ?? payload.after) as
    | { id?: string; message?: string }
    | string
    | undefined;

  return {
    eventRepositoryId: repository?.id ?? null,
    eventRepositoryName: repository?.full_name ?? repository?.name ?? null,
    ref: typeof payload.ref === "string" ? payload.ref : null,
    action: typeof payload.action === "string" ? payload.action : null,
    headCommitSha:
      typeof headCommit === "string"
        ? headCommit
        : typeof headCommit?.id === "string"
          ? headCommit.id
          : null,
    pullRequestNumber:
      typeof (payload.pull_request as { number?: number } | undefined)?.number === "number"
        ? (payload.pull_request as { number: number }).number
        : null,
  };
}

export function loadWebhookPayloadFromJobMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const stored = metadata?.webhookPayload;
  if (!stored || typeof stored !== "object") {
    throw new Error("Webhook payload missing from scan job metadata");
  }
  return stored as Record<string, unknown>;
}

export function rehydrateWebhookProcessPayload(
  scanJobId: string,
  metadata: Record<string, unknown> | null | undefined
): WebhookProcessPayload {
  const webhookPayload = loadWebhookPayloadFromJobMetadata(metadata);
  return {
    scanJobId,
    deliveryId: typeof metadata?.deliveryId === "string" ? metadata.deliveryId : null,
    eventType: typeof metadata?.eventType === "string" ? metadata.eventType : "unknown",
    payload: webhookPayload,
  };
}
