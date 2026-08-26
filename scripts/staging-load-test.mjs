#!/usr/bin/env node
/**
 * Staging-only controlled load testing for Phase 1 async pipeline.
 *
 * Usage:
 *   STAGING_BASE_URL=https://staging.example.com LOAD_TEST_CONFIRM=yes node scripts/staging-load-test.mjs --scenario=duplicate-webhook
 *   STAGING_BASE_URL=http://localhost:3000 LOAD_TEST_ALLOW_LOCALHOST=true LOAD_TEST_CONFIRM=yes node scripts/staging-load-test.mjs --scenario=webhook-burst
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";
import { assertStagingTarget, requireExplicitConfirmation } from "./lib/load-test-guards.mjs";

config({ path: resolve(process.cwd(), ".env.local"), override: true });
config({ path: resolve(process.cwd(), ".env"), override: true });

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "true"];
  })
);

const STAGING_BASE_URL = process.env.STAGING_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const PROTECTION_BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";

if (!STAGING_BASE_URL) {
  throw new Error("STAGING_BASE_URL is required");
}
assertStagingTarget(STAGING_BASE_URL);

const report = {
  scenario: args.scenario ?? "duplicate-webhook",
  baseUrl: STAGING_BASE_URL,
  requestsSent: 0,
  accepted: 0,
  rejected: 0,
  duplicates: 0,
  failures: 0,
  latenciesMs: [],
  startedAt: new Date().toISOString(),
};

function sign(body) {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
}

async function postWebhook(deliveryId) {
  const body = JSON.stringify({
    repository: { id: 999001, full_name: "staging/load-test" },
    ref: "refs/heads/main",
    after: "abc1234567890",
  });
  const started = Date.now();
  const response = await fetch(`${STAGING_BASE_URL.replace(/\/$/, "")}/api/webhooks/github`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": sign(body),
      ...(PROTECTION_BYPASS ? { "x-vercel-protection-bypass": PROTECTION_BYPASS } : {}),
    },
    body,
  });
  const latencyMs = Date.now() - started;
  report.latenciesMs.push(latencyMs);
  report.requestsSent += 1;
  const json = await response.json().catch(() => ({}));
  if (response.status === 202) report.accepted += 1;
  else report.rejected += 1;
  if (json.duplicate) report.duplicates += 1;
  if (response.status >= 500) report.failures += 1;
  return { response, json, latencyMs };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function scenarioDuplicateWebhook() {
  const deliveryId = `load-test-${Date.now()}`;
  await postWebhook(deliveryId);
  await postWebhook(deliveryId);
}

async function scenarioWebhookBurst() {
  requireExplicitConfirmation("webhook-burst");
  const tasks = Array.from({ length: 100 }, (_, index) => postWebhook(`burst-${Date.now()}-${index}`));
  await Promise.all(tasks);
}

async function main() {
  if (!WEBHOOK_SECRET) throw new Error("GITHUB_WEBHOOK_SECRET is required for webhook scenarios");

  switch (report.scenario) {
    case "duplicate-webhook":
      await scenarioDuplicateWebhook();
      break;
    case "webhook-burst":
      await scenarioWebhookBurst();
      break;
    default:
      throw new Error(`Unknown scenario: ${report.scenario}`);
  }

  report.completedAt = new Date().toISOString();
  report.summary = {
    p50LatencyMs: percentile(report.latenciesMs, 50),
    p95LatencyMs: percentile(report.latenciesMs, 95),
    p99LatencyMs: percentile(report.latenciesMs, 99),
    estimatedAiCostUsd: 0,
    note: "Manual scan scenarios (A,C) and failure drills (F,G) require authenticated staging credentials and are documented in docs/operations/staging-load-testing.md",
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
