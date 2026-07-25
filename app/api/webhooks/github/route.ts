import { NextResponse } from "next/server";
import { verifyGitHubWebhookSignature } from "@/server/github-automation/webhook-utils";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { ingestGitHubWebhook } from "@/server/jobs/webhook-ingress";

export const runtime = "nodejs";
export const maxDuration = 30;

function webhookSecret(): string | null {
  return process.env.GITHUB_WEBHOOK_SECRET ?? null;
}

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const secret = webhookSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook secret not configured", code: "WEBHOOK_MISCONFIGURED" },
      { status: 503 }
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  }

  const deliveryId = request.headers.get("x-github-delivery");
  const eventType = request.headers.get("x-github-event") ?? "unknown";
  const signature = request.headers.get("x-hub-signature-256");
  const rawBody = await request.text();

  if (!verifyGitHubWebhookSignature(rawBody, signature, secret)) {
    console.warn({
      component: "github-webhook",
      event: "invalid_signature",
      deliveryId,
      eventType,
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const ingress = await ingestGitHubWebhook({ deliveryId, eventType, payload });

  if (ingress.status === "duplicate") {
    console.info({
      component: "github-webhook",
      event: "duplicate_delivery",
      deliveryId,
      eventType,
    });
  } else {
    console.info({
      component: "github-webhook",
      event: "delivery_accepted",
      deliveryId,
      eventType,
      scanJobId: ingress.status === "accepted" ? ingress.scanJobId : null,
    });
  }

  return NextResponse.json(
    {
      received: true,
      duplicate: ingress.status === "duplicate",
      event: eventType,
      deliveryId,
      ...(ingress.status === "accepted" ? { scanJobId: ingress.scanJobId } : {}),
    },
    { status: 202 }
  );
}
