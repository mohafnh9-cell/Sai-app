#!/usr/bin/env node
/**
 * Phase 1 staging validation helper.
 *
 * Usage:
 *   node scripts/staging-validate-phase1.mjs
 *   node scripts/staging-validate-phase1.mjs --repair-stuck
 *   STAGING_BASE_URL=https://staging.sequrai.com node scripts/staging-validate-phase1.mjs --smoke
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in env.
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

config({ path: resolve(process.cwd(), ".env.local"), override: true });
config({ path: resolve(process.cwd(), ".env"), override: true });

const args = new Set(process.argv.slice(2));
const STAGING_BASE_URL = process.env.STAGING_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const STALE_MINUTES = Number(process.env.SCAN_JOB_STALE_MINUTES ?? "15");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function signWebhook(body) {
  const digest = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  return `sha256=${digest}`;
}

async function getAdmin() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function printJobHealth() {
  section("Scan job health");
  const admin = await getAdmin();
  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();

  const [{ data: queued }, { data: running }, { data: stuck }] = await Promise.all([
    admin.from("scan_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    admin.from("scan_jobs").select("id", { count: "exact", head: true }).eq("status", "running"),
    admin
      .from("scan_jobs")
      .select("id, job_type, organization_id, project_id, scan_id, status, failure_code, updated_at")
      .in("status", ["queued", "running"])
      .lt("updated_at", staleBefore)
      .order("updated_at", { ascending: true })
      .limit(20),
  ]);

  console.log(`Queued jobs: ${queued?.length ?? 0}`);
  console.log(`Running jobs: ${running?.length ?? 0}`);
  console.log(`Stuck jobs (> ${STALE_MINUTES}m): ${stuck?.length ?? 0}`);
  for (const job of stuck ?? []) {
    console.log(
      `  - ${job.id} type=${job.job_type} org=${job.organization_id} status=${job.status} updated=${job.updated_at}`
    );
  }
}

async function repairStuckJobs() {
  section("Repair stuck jobs");
  const admin = await getAdmin();
  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
  const { data: stuck } = await admin
    .from("scan_jobs")
    .select("id, status")
    .in("status", ["queued", "running"])
    .lt("updated_at", staleBefore);

  let repaired = 0;
  for (const job of stuck ?? []) {
    const { error } = await admin
      .from("scan_jobs")
      .update({
        status: "failed",
        failure_code: "SCAN_JOB_TIMEOUT",
        failure_message: "Scan job exceeded its execution lease",
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .in("status", ["queued", "running"]);
    if (!error) repaired += 1;
  }
  console.log(`Marked ${repaired} stuck job(s) as failed (SCAN_JOB_TIMEOUT).`);
}

async function duplicateWebhookSmoke() {
  section("Duplicate webhook smoke");
  if (!WEBHOOK_SECRET) {
    console.log("Skip: GITHUB_WEBHOOK_SECRET not set");
    return;
  }

  const deliveryId = `staging-validate-${Date.now()}`;
  const body = JSON.stringify({
    repository: { id: 0, full_name: "staging/unknown" },
    ref: "refs/heads/main",
    after: "0000000000000000000000000000000000000000",
  });

  const headers = {
    "content-type": "application/json",
    "x-github-event": "push",
    "x-github-delivery": deliveryId,
    "x-hub-signature-256": signWebhook(body),
  };

  const url = `${STAGING_BASE_URL.replace(/\/$/, "")}/api/webhooks/github`;
  const first = await fetch(url, { method: "POST", headers, body });
  const second = await fetch(url, { method: "POST", headers, body });
  const firstJson = await first.json();
  const secondJson = await second.json();

  console.log(`First response: ${first.status}`, firstJson);
  console.log(`Second response: ${second.status}`, secondJson);
  console.log(
    secondJson.duplicate === true
      ? "PASS: duplicate delivery rejected at ingress"
      : "CHECK: duplicate flag not set — inspect scan_jobs + repository_events"
  );
}

async function printSchedulerMode() {
  section("Scheduler mode");
  console.log(`SCAN_SCHEDULER=${process.env.SCAN_SCHEDULER ?? "inline (default)"}`);
  console.log(`INNGEST_EVENT_KEY=${process.env.INNGEST_EVENT_KEY ? "[set]" : "[missing]"}`);
  console.log(`INNGEST_SIGNING_KEY=${process.env.INNGEST_SIGNING_KEY ? "[set]" : "[missing]"}`);
}

async function printDedupCoverage() {
  section("Deduplication coverage");
  console.log("- GitHub delivery ID: unique idx_scan_jobs_webhook_delivery + repository_events.github_delivery_id");
  console.log("- scan ID: unique idx_scan_jobs_active_scan for queued/running jobs");
  console.log("- project ID: scans partial unique index (one active scan per repository)");
  console.log("- commit SHA: automatic_review queries + pull_request_scans upsert key");
  console.log("- event type: stored in scan_jobs.metadata only (not a dedup key alone)");
}

async function main() {
  console.log(`Phase 1 staging validation`);
  console.log(`Target: ${STAGING_BASE_URL}`);

  await printSchedulerMode();
  await printDedupCoverage();
  await printJobHealth();

  if (args.has("--repair-stuck")) {
    await repairStuckJobs();
    await printJobHealth();
  }

  if (args.has("--smoke")) {
    await duplicateWebhookSmoke();
  }

  section("Manual checks still required in staging");
  console.log("1. Trigger manual scan from UI → expect HTTP 202 + scan_jobs row → completed");
  console.log("2. Push to linked repo → webhook 202 < 500ms → scan queued → verdict persisted");
  console.log("3. Send 5 concurrent manual scans in one org → max 3 running, others queued in Inngest");
  console.log("4. Force recoverable failure (revoke GitHub token mid-scan) → retry succeeds once token restored");
  console.log("5. Force permanent failure (disconnect repo) → job ends failed after retries");
  console.log("6. Flip SCAN_SCHEDULER=inline → repeat manual scan smoke → still completes");
  console.log("7. Inspect Inngest dashboard event payloads → webhook events contain scanJobId only");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
