import "server-only";

import { createAdminClient } from "@/server/security-scanner/admin-client";
import { ingestGitHubWebhook } from "@/server/jobs/webhook-ingress";
import { processGitHubAppInstallationEvent } from "./installation-events";

export type GitHubAppWebhookIngressResult =
  | { status: "duplicate"; action: string }
  | { status: "accepted"; action: string };

export async function ingestGitHubAppWebhook(input: {
  deliveryId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<GitHubAppWebhookIngressResult> {
  if (input.eventType === "installation" || input.eventType === "installation_repositories") {
    const result = await processGitHubAppInstallationEvent({
      admin: createAdminClient(),
      eventType: input.eventType,
      payload: input.payload,
    });
    return { status: "accepted", action: result.action };
  }

  const repository = input.payload.repository as { id?: number } | undefined;
  if (repository?.id) {
    const ingress = await ingestGitHubWebhook({
      deliveryId: input.deliveryId,
      eventType: input.eventType,
      payload: input.payload,
    });
    return {
      status: ingress.status === "duplicate" ? "duplicate" : "accepted",
      action: ingress.status === "duplicate" ? "duplicate_delivery" : "repository_event_scheduled",
    };
  }

  return { status: "accepted", action: "ignored" };
}
