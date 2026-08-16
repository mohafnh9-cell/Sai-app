import "server-only";

import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  isDeliveryAlreadyHandled,
} from "@/server/github-automation/delivery-idempotency";
import { processGitHubAppInstallationEvent } from "./installation-events";
import { processGitHubWebhookEvent } from "@/server/github-automation/orchestrator";

export type GitHubAppWebhookIngressResult =
  | { status: "duplicate"; action: string }
  | { status: "accepted"; action: string };

export async function ingestGitHubAppWebhook(input: {
  deliveryId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<GitHubAppWebhookIngressResult> {
  const admin = createAdminClient();

  if (input.deliveryId && (await isDeliveryAlreadyHandled(admin, input.deliveryId))) {
    return { status: "duplicate", action: "duplicate_delivery" };
  }

  if (input.eventType === "installation" || input.eventType === "installation_repositories") {
    const result = await processGitHubAppInstallationEvent({
      admin,
      eventType: input.eventType,
      payload: input.payload,
    });
    return { status: "accepted", action: result.action };
  }

  const repository = input.payload.repository as { id?: number } | undefined;
  if (repository?.id) {
    await processGitHubWebhookEvent({
      eventType: input.eventType,
      deliveryId: input.deliveryId,
      payload: input.payload,
    });
    return { status: "accepted", action: "repository_event_forwarded" };
  }

  return { status: "accepted", action: "ignored" };
}
