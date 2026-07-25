#!/usr/bin/env node
/**
 * Phase 1.6 staging validation — scenarios A through L.
 *
 * Usage:
 *   node scripts/staging-validate-phase1-6.mjs --checklist
 *   STAGING_BASE_URL=https://staging.example.com INTERNAL_OPS_TOKEN=... node scripts/staging-validate-phase1-6.mjs --health
 *   node scripts/staging-validate-phase1-6.mjs --preflight
 *   node scripts/staging-validate-phase1-6.mjs --metrics
 *
 * Scenarios requiring live staging credentials are marked MANUAL.
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { assertStagingTarget } from "./lib/load-test-guards.mjs";

config({ path: resolve(process.cwd(), ".env.local"), override: true });
config({ path: resolve(process.cwd(), ".env"), override: true });

const args = new Set(process.argv.slice(2));

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function getAdmin() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const SCENARIOS = [
  { id: "A", name: "Manual scan", mode: "MANUAL", expected: "queued → running → completed; one verdict; no duplicate notifications" },
  { id: "B", name: "GitHub push webhook", mode: "MANUAL", expected: "HTTP 202; webhook job; scan scheduled; verdict finalized; GitHub status once" },
  { id: "C", name: "Duplicate GitHub delivery", mode: "AUTO", script: "load-test:staging --scenario=duplicate-webhook" },
  { id: "D", name: "Five scans one org (concurrency 3)", mode: "MANUAL", expected: "max 3 running; rest queued; none lost" },
  { id: "E", name: "Fifty scans multi-org", mode: "MANUAL", expected: "tenant isolation; all jobs accounted for" },
  { id: "F", name: "Burst 100 webhooks", mode: "AUTO", script: "load-test:staging --scenario=webhook-burst" },
  { id: "G", name: "Recoverable worker failure", mode: "MANUAL", expected: "retry; safe reclaim; no duplicate side effects" },
  { id: "H", name: "Permanent worker failure", mode: "MANUAL", expected: "failed terminal; failure_code persisted; no infinite retry" },
  { id: "I", name: "Stuck queued job", mode: "MANUAL", script: "inject-stale-queued + wait for recovery cron" },
  { id: "J", name: "Stuck running job", mode: "MANUAL", script: "inject-expired-running + wait for recovery cron" },
  { id: "K", name: "Completed scan unfinished job", mode: "MANUAL", expected: "recovery finalizes without duplicate side effects" },
  { id: "L", name: "Rollback SCAN_SCHEDULER=inline", mode: "MANUAL", expected: "new scans work without Inngest events" },
];

async function printChecklist() {
  section("Phase 1.6 staging validation checklist");
  for (const scenario of SCENARIOS) {
    console.log(`${scenario.id}. ${scenario.name} [${scenario.mode}]`);
    console.log(`   Expected: ${scenario.expected}`);
    if (scenario.script) console.log(`   Command: npm run ${scenario.script}`);
  }
  console.log("\nRecord results in docs/operations/phase1-6-staging-results.md");
}

async function validateEnv() {
  section("Environment validation");
  const required = {
    SCAN_SCHEDULER: process.env.SCAN_SCHEDULER,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ? "[set]" : undefined,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY ? "[set]" : undefined,
    INTERNAL_OPS_TOKEN: process.env.INTERNAL_OPS_TOKEN ? "[set]" : undefined,
    STAGING_BASE_URL: process.env.STAGING_BASE_URL,
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET ? "[set]" : undefined,
  };

  for (const [key, value] of Object.entries(required)) {
    console.log(`${key}: ${value ?? "MISSING"}`);
  }

  if (process.env.SCAN_SCHEDULER === "inngest") {
    if (!process.env.INNGEST_EVENT_KEY?.trim()) throw new Error("INNGEST_EVENT_KEY required when SCAN_SCHEDULER=inngest");
    if (!process.env.INNGEST_SIGNING_KEY?.trim()) throw new Error("INNGEST_SIGNING_KEY required when SCAN_SCHEDULER=inngest");
  }
  if (!process.env.INTERNAL_OPS_TOKEN?.trim()) {
    console.warn("WARN: INTERNAL_OPS_TOKEN not set — health endpoint will return 401 for all requests");
  }
}

async function checkHealth() {
  section("Health endpoint");
  const baseUrl = requireEnv("STAGING_BASE_URL");
  assertStagingTarget(baseUrl);
  const token = process.env.INTERNAL_OPS_TOKEN?.trim();

  const unauthorized = await fetch(`${baseUrl.replace(/\/$/, "")}/api/internal/jobs/health`);
  console.log(`Without token: HTTP ${unauthorized.status} (expected 401)`);
  if (unauthorized.status !== 401) throw new Error("Health endpoint must return 401 without token");

  if (!token) {
    console.log("Skipping authorized health check — INTERNAL_OPS_TOKEN not set");
    return;
  }

  const authorized = await fetch(`${baseUrl.replace(/\/$/, "")}/api/internal/jobs/health`, {
    headers: { "x-sequrai-ops-token": token },
  });
  console.log(`With token: HTTP ${authorized.status} (expected 200)`);
  if (!authorized.ok) throw new Error(`Authorized health check failed: ${authorized.status}`);
  const body = await authorized.json();
  console.log(`schedulerMode=${body.schedulerMode} stuckJobs=${body.stuckJobs} alertsHealthy=${body.alerts?.healthy}`);
}

async function collectMetrics() {
  section("Pipeline metrics (last 24h)");
  const admin = await getAdmin();
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    created,
    completed,
    failed,
    retried,
    recovered,
    timedOut,
    duplicates,
    queueWaits,
    durations,
    stuck,
    idempotencyRows,
  ] = await Promise.all([
    admin.from("scan_job_events").select("id", { count: "exact", head: true }).eq("event_type", "job_created").gte("created_at", last24h),
    admin.from("scan_job_events").select("id", { count: "exact", head: true }).eq("event_type", "job_completed").gte("created_at", last24h),
    admin.from("scan_job_events").select("id", { count: "exact", head: true }).eq("event_type", "job_failed").gte("created_at", last24h),
    admin.from("scan_job_events").select("id", { count: "exact", head: true }).eq("event_type", "job_retried").gte("created_at", last24h),
    admin.from("scan_job_events").select("id", { count: "exact", head: true }).eq("event_type", "job_recovered").gte("created_at", last24h),
    admin.from("scan_job_events").select("id", { count: "exact", head: true }).eq("event_type", "job_timed_out").gte("created_at", last24h),
    admin.from("scan_job_events").select("id", { count: "exact", head: true }).eq("event_type", "duplicate_webhook_detected").gte("created_at", last24h),
    admin.from("scan_job_events").select("queue_wait_ms").eq("event_type", "job_started").gte("created_at", last24h).not("queue_wait_ms", "is", null).limit(5000),
    admin.from("scan_job_events").select("duration_ms").eq("event_type", "job_completed").gte("created_at", last24h).not("duration_ms", "is", null).limit(5000),
    admin.from("scan_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]).lt("updated_at", new Date(Date.now() - 10 * 60 * 1000).toISOString()),
    admin.from("operation_idempotency").select("idempotency_key", { count: "exact", head: true }).gte("created_at", last24h),
  ]);

  const queueValues = (queueWaits.data ?? []).map((r) => r.queue_wait_ms).filter(Number.isFinite);
  const durationValues = (durations.data ?? []).map((r) => r.duration_ms).filter(Number.isFinite);

  const report = {
    jobsCreated: created.count ?? 0,
    jobsCompleted: completed.count ?? 0,
    jobsFailed: failed.count ?? 0,
    jobsRetried: retried.count ?? 0,
    jobsRecovered: recovered.count ?? 0,
    jobsTimedOut: timedOut.count ?? 0,
    duplicatesDetected: duplicates.count ?? 0,
    stuckJobs: stuck.count ?? 0,
    idempotencyRecords: idempotencyRows.count ?? 0,
    queueWaitMs: {
      p50: percentile(queueValues, 50),
      p95: percentile(queueValues, 95),
      p99: percentile(queueValues, 99),
    },
    jobDurationMs: {
      p50: percentile(durationValues, 50),
      p95: percentile(durationValues, 95),
      p99: percentile(durationValues, 99),
    },
    estimatedAiCostUsd: null,
    note: "Set estimatedAiCostUsd manually from provider billing during staging runs",
  };

  console.log(JSON.stringify(report, null, 2));
}

async function injectStaleQueuedJob() {
  section("Inject stale queued job (scenario I)");
  requireExplicitConfirmation("inject-stale-queued");
  const admin = await getAdmin();
  const staleAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("scan_jobs")
    .insert({
      organization_id: requireEnv("STAGING_TEST_ORG_ID"),
      job_type: "manual_scan",
      status: "queued",
      scheduled_at: staleAt,
      updated_at: staleAt,
      metadata: { injected: "phase1-6-stale-queued" },
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  console.log(`Injected stale queued job: ${data?.id}`);
  console.log("Wait up to 5 minutes for scan-job-recovery cron.");
}

async function injectExpiredRunningJob() {
  section("Inject expired running job (scenario J)");
  requireExplicitConfirmation("inject-expired-running");
  const admin = await getAdmin();
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("scan_jobs")
    .insert({
      organization_id: requireEnv("STAGING_TEST_ORG_ID"),
      job_type: "manual_scan",
      status: "running",
      started_at: past,
      execution_deadline_at: past,
      updated_at: past,
      metadata: { injected: "phase1-6-expired-running" },
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  console.log(`Injected expired running job: ${data?.id}`);
}

function requireExplicitConfirmation(flag) {
  if (process.env.LOAD_TEST_CONFIRM !== "yes") {
    throw new Error(`Set LOAD_TEST_CONFIRM=yes to run ${flag}`);
  }
}

async function main() {
  if (args.has("--checklist") || args.size === 0) await printChecklist();
  if (args.has("--env")) await validateEnv();
  if (args.has("--health")) await checkHealth();
  if (args.has("--metrics")) await collectMetrics();
  if (args.has("--preflight")) {
    const { spawnSync } = await import("node:child_process");
    spawnSync("node", ["scripts/migration-preflight.mjs"], { stdio: "inherit" });
  }
  if (args.has("--inject-stale-queued")) await injectStaleQueuedJob();
  if (args.has("--inject-expired-running")) await injectExpiredRunningJob();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
