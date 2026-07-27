#!/usr/bin/env node
/**
 * Platform Convergence — staging certification inspector.
 *
 * Usage:
 *   npm run validate:platform-convergence:staging
 *   npm run validate:platform-convergence:staging -- --preflight-only
 *   STAGING_CERT_SCAN_JOB_ID=<uuid> npm run validate:platform-convergence:staging -- --inspect
 *   STAGING_CERT_SCAN_JOB_ID=<uuid> npm run validate:platform-convergence:staging -- --poll --timeout-ms=900000
 *
 * Refuses production hosts. Does not print secrets.
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  validatePlatformMetadataShape,
  validateVerdictLinkage,
  validateIdentifierMatrix,
} from "../server/platform-convergence/validate-platform-metadata.mjs";

config({ path: resolve(process.cwd(), ".env.local"), override: true });
config({ path: resolve(process.cwd(), ".env"), override: true });

const args = new Set(process.argv.slice(2));
const PREFLIGHT_ONLY = args.has("--preflight-only");
const INSPECT = args.has("--inspect");
const POLL = args.has("--poll");
const timeoutArg = process.argv.find((a) => a.startsWith("--timeout-ms="));
const POLL_TIMEOUT_MS = timeoutArg ? Number(timeoutArg.split("=")[1]) : 900_000;
const POLL_INTERVAL_MS = 5_000;

const PRODUCTION_HOST_PATTERNS = [
  /^https:\/\/app\.sequrai\.com/i,
  /^https:\/\/www\.sequrai\.com/i,
  /^https:\/\/sequrai\.com/i,
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  return value;
}

function isProductionTarget() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  const stagingUrl = (process.env.STAGING_BASE_URL ?? "").trim();
  const nodeEnv = (process.env.NODE_ENV ?? "").trim();
  if (nodeEnv === "production") return true;
  for (const url of [appUrl, stagingUrl]) {
    if (!url) continue;
    for (const re of PRODUCTION_HOST_PATTERNS) {
      if (re.test(url)) return true;
    }
  }
  if (process.env.PLATFORM_CONVERGENCE_CERT_ALLOW_PRODUCTION === "1") return false;
  return false;
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(invalid url)";
  }
}

async function checkPreconditions() {
  const missing = [];
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const stagingBase = requireEnv("STAGING_BASE_URL");
  const orgId = requireEnv("STAGING_CERT_ORG_ID");
  const projectId = requireEnv("STAGING_CERT_PROJECT_ID");

  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!stagingBase) missing.push("STAGING_BASE_URL");
  if (!orgId) missing.push("STAGING_CERT_ORG_ID");
  if (!projectId) missing.push("STAGING_CERT_PROJECT_ID");

  const flagsOk =
    process.env.FEATURE_RT9_BUSINESS_LOGIC !== undefined ||
    process.env.FEATURE_LLM_RED_TEAM !== undefined ||
    args.has("--skip-flag-check");
  if (!flagsOk) {
    missing.push("FEATURE_RT9_BUSINESS_LOGIC or FEATURE_LLM_RED_TEAM (or pass --skip-flag-check)");
  }

  if (isProductionTarget()) {
    return {
      ok: false,
      missing: ["Refusing production target (NODE_ENV=production or production APP/STAGING URL)"],
      env: { stagingBase: stagingBase ? redactUrl(stagingBase) : null },
    };
  }

  let runnerHint = "not_checked";
  if (!args.has("--preflight-only") && supabaseUrl && serviceKey) {
    try {
      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { count: stuck } = await admin
        .from("scan_jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ["queued", "running"])
        .lt("updated_at", staleBefore);
      runnerHint = stuck && stuck > 5 ? "degraded (many stale jobs)" : "reachable";
    } catch {
      runnerHint = "unreachable (client init or query failed)";
    }
  } else if (args.has("--preflight-only") && supabaseUrl && serviceKey) {
    runnerHint = "skipped_in_preflight";
  }

  return {
    ok: missing.length === 0,
    missing,
    env: {
      stagingBase: stagingBase ? redactUrl(stagingBase) : null,
      supabaseHost: supabaseUrl ? redactUrl(supabaseUrl) : null,
      orgIdPresent: Boolean(orgId),
      projectIdPresent: Boolean(projectId),
      scanJobId: requireEnv("STAGING_CERT_SCAN_JOB_ID") ?? null,
      jobRunner: runnerHint,
    },
  };
}

async function getAdmin() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadScanJob(admin, scanJobId) {
  const { data, error } = await admin.from("scan_jobs").select("*").eq("id", scanJobId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function pollUntilComplete(admin, scanJobId) {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const job = await loadScanJob(admin, scanJobId);
    if (!job) throw new Error(`Scan job not found: ${scanJobId}`);
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${POLL_TIMEOUT_MS}ms waiting for scan job ${scanJobId}`);
}

async function loadVerdictsForScan(admin, scanId, projectId) {
  const { data, error } = await admin
    .from("production_verdicts")
    .select("id, scan_id, project_id, generated_at, verdict, status")
    .eq("scan_id", scanId)
    .eq("project_id", projectId)
    .order("generated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

function buildMissionControlSnapshotFromDb({ job, verdictRows }) {
  const meta = job?.metadata ?? {};
  const platform = meta.platform ?? meta.platformConvergence;
  const latestVerdict = verdictRows[0]?.verdict ?? null;
  return {
    scanJobId: job?.id ?? null,
    scanId: job?.scan_id ?? null,
    platformPipelineStatus: platform?.pipelineStatus ?? null,
    teamExecution: platform?.teamExecution ?? null,
    teamRunIds: platform?.teamRunIds ?? null,
    decisionId: platform?.ids?.decisionId ?? null,
    verdictSecurityDecisionId: latestVerdict?.securityDecisionId ?? null,
    verdictStatus: latestVerdict?.status ?? verdictRows[0]?.status ?? null,
  };
}

async function certifyJob(admin, scanJobId, projectId) {
  const checks = [];
  const job = POLL ? await pollUntilComplete(admin, scanJobId) : await loadScanJob(admin, scanJobId);
  if (!job) {
    return { passed: false, checks: [{ name: "scan_job", ok: false, detail: "not found" }] };
  }

  if (job.project_id !== projectId) {
    checks.push({ name: "project_scope", ok: false, detail: "scan job project mismatch" });
  } else {
    checks.push({ name: "project_scope", ok: true });
  }

  const metadata = job.metadata ?? {};
  const metaValidation = validatePlatformMetadataShape(metadata);
  checks.push({
    name: "metadata_runtime_shape",
    ok: metaValidation.valid,
    issues: metaValidation.issues,
  });

  const platform = metadata.platform ?? metadata.platformConvergence;
  if (platform?.ids) {
    const matrix = validateIdentifierMatrix(platform.ids);
    checks.push({ name: "identifier_matrix", ok: matrix.ok, mismatches: matrix.mismatches });
  } else {
    checks.push({ name: "identifier_matrix", ok: false, detail: "missing platform.ids" });
  }

  const scanId = job.scan_id;
  const verdictRows = scanId ? await loadVerdictsForScan(admin, scanId, projectId) : [];
  const activeForScan = verdictRows.filter((r) => r.scan_id === scanId);
  checks.push({
    name: "single_verdict_per_scan",
    ok: activeForScan.length === 1,
    count: activeForScan.length,
    note: "Historical rows for other scans are ignored",
  });

  const verdictJson = activeForScan[0]?.verdict ?? null;
  const linkage = validateVerdictLinkage({ platformMetadata: metadata, verdictJson });
  checks.push({ name: "verdict_linkage", ok: linkage.valid, issues: linkage.issues });

  const mcSnapshot = buildMissionControlSnapshotFromDb({ job, verdictRows: activeForScan });
  const mcOk =
    mcSnapshot.decisionId == null ||
    mcSnapshot.verdictSecurityDecisionId == null ||
    mcSnapshot.decisionId === mcSnapshot.verdictSecurityDecisionId;
  checks.push({ name: "mission_control_db_parity", ok: mcOk, snapshot: mcSnapshot });

  if (platform?.teamExecution?.["ai.llm"] === "skipped" || platform?.teamExecution?.llm === "skipped") {
    checks.push({ name: "rt10_disabled_marker", ok: true, teamExecution: platform.teamExecution });
  }

  const passed = checks.every((c) => c.ok);
  return {
    passed,
    checks,
    identifiers: platform?.ids ?? null,
    teamRunIds: platform?.teamRunIds ?? null,
    scanJobStatus: job.status,
    missionControl: mcSnapshot,
  };
}

async function main() {
  const pre = await checkPreconditions();
  const result = {
    certification: "platform-convergence-staging",
    timestamp: new Date().toISOString(),
    preconditions: pre,
    scenarios: {},
    releaseDecision: pre.ok ? "PENDING" : "NO-GO",
  };

  if (!pre.ok) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  if (PREFLIGHT_ONLY) {
    result.releaseDecision = "PRECONDITIONS_OK";
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  const scanJobId = requireEnv("STAGING_CERT_SCAN_JOB_ID");
  if (!scanJobId) {
    result.releaseDecision = "NO-GO";
    result.error = "STAGING_CERT_SCAN_JOB_ID required for --inspect or --poll (Scenario A–D)";
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const admin = await getAdmin();
  const projectId = requireEnv("STAGING_CERT_PROJECT_ID");
  const scenario = requireEnv("STAGING_CERT_SCENARIO") ?? "A";
  const cert = await certifyJob(admin, scanJobId, projectId);
  result.scenarios[scenario] = cert;
  result.releaseDecision = cert.passed ? "GO" : "CONDITIONAL_GO";
  if (!cert.passed) result.releaseDecision = "NO-GO";

  console.log(JSON.stringify(result, null, 2));
  process.exit(cert.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(JSON.stringify({ certification: "platform-convergence-staging", error: err.message }));
  process.exit(1);
});
