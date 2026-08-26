import { NextResponse } from "next/server";
import { verifyGitHubWebhookSignature } from "@/server/github-automation/webhook-utils";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { ingestGitHubAppWebhook } from "@/server/github-app/webhook-ingress";

export const runtime = "nodejs";
export const maxDuration = 30;

function appWebhookSecret(): string | null {
  return process.env.GITHUB_APP_WEBHOOK_SECRET?.trim() ?? null;
}

export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const secret = appWebhookSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "GitHub App webhook secret not configured", code: "WEBHOOK_MISCONFIGURED" },
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
      component: "github-app-webhook",
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

  const ingress = await ingestGitHubAppWebhook({ deliveryId, eventType, payload });

  return NextResponse.json(
    {
      received: true,
      source: "github_app",
      duplicate: ingress.status === "duplicate",
      event: eventType,
      deliveryId,
      action: ingress.action,
    },
    { status: 202 }
  );
}
