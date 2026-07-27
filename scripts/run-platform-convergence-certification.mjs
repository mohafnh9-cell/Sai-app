#!/usr/bin/env node
/**
 * Platform Convergence — certification runner (staging + main modes).
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  validatePlatformMetadataShape,
  validateVerdictLinkage,
  validateIdentifierMatrix,
} from "../server/platform-convergence/validate-platform-metadata.mjs";
import {
  evaluateMainCertificationPreflight,
  evaluateStagingCertificationGate,
  evaluateMainCertificationGate,
  trimEnv,
  redactUrl,
  validateCertificationProjectRecord,
  validateSingleScanJobInspect,
  validateLiveScenarioForMode,
  isFaultInjectionEnabled,
} from "./lib/platform-convergence-certification.mjs";

config({ path: resolve(process.cwd(), ".env.local"), override: true });
config({ path: resolve(process.cwd(), ".env"), override: true });

export async function runPlatformConvergenceCertification(options) {
  const mode = options.mode;
  const argv = options.argv ?? process.argv.slice(2);
  const args = new Set(argv);
  const env = options.env ?? process.env;
  const cliArgs = {
    skipFlagCheck: args.has("--skip-flag-check"),
    preflightOnly: args.has("--preflight-only"),
    inspect: args.has("--inspect"),
    poll: args.has("--poll"),
  };

  const timeoutArg = argv.find((a) => a.startsWith("--timeout-ms="));
  const POLL_TIMEOUT_MS = timeoutArg ? Number(timeoutArg.split("=")[1]) : 900_000;
  const POLL_INTERVAL_MS = 5_000;

  const pre =
    mode === "main"
      ? evaluateMainCertificationPreflight(env, cliArgs)
      : evaluateStagingCertificationGate(env, cliArgs);

  const result = {
    certification: "platform-convergence",
    certificationEnvironment: mode === "main" ? "main" : "staging",
    timestamp: new Date().toISOString(),
    preconditions: {
      ok: pre.ok,
      missing: pre.missing,
      env: {
        certificationEnvironment: pre.certificationEnvironment,
        targetBaseUrl:
          mode === "main"
            ? redactUrl(trimEnv(env, "MAIN_CERTIFICATION_URL"))
            : redactUrl(trimEnv(env, "STAGING_BASE_URL")),
        supabaseHost: redactUrl(trimEnv(env, "NEXT_PUBLIC_SUPABASE_URL")),
        orgIdPresent: Boolean(trimEnv(env, "STAGING_CERT_ORG_ID")),
        projectIdPresent: Boolean(trimEnv(env, "STAGING_CERT_PROJECT_ID")),
        scanJobId: trimEnv(env, "STAGING_CERT_SCAN_JOB_ID") || null,
        faultInjectionEnabled: isFaultInjectionEnabled(env),
        nodeEnv: trimEnv(env, "NODE_ENV") || null,
        note: "NODE_ENV is not used as the sole safety control",
      },
    },
    scenarios: {},
    releaseDecision: pre.ok ? "PENDING" : "NO-GO",
  };

  if (!pre.ok) {
    return { exitCode: 1, result };
  }

  if (cliArgs.preflightOnly) {
    result.releaseDecision = "PRECONDITIONS_OK";
    return { exitCode: 0, result };
  }

  if (!cliArgs.inspect && !cliArgs.poll) {
    result.releaseDecision = "NO-GO";
    result.error = "Pass --inspect or --poll for live Scenario A validation";
    return { exitCode: 1, result };
  }

  const scenarioCheck = validateLiveScenarioForMode(env, mode);
  if (!scenarioCheck.ok) {
    result.releaseDecision = "NO-GO";
    result.error = scenarioCheck.errors.join("; ");
    return { exitCode: 1, result };
  }

  const jobCheck = validateSingleScanJobInspect(env);
  if (!jobCheck.ok) {
    result.releaseDecision = "NO-GO";
    result.error = jobCheck.errors.join("; ");
    return { exitCode: 1, result };
  }

  if (mode === "main") {
    const mainGate = evaluateMainCertificationGate(env);
    if (!mainGate.ok) {
      result.releaseDecision = "NO-GO";
      result.error = mainGate.errors.join("; ");
      return { exitCode: 1, result };
    }
  }

  const admin = createClient(trimEnv(env, "NEXT_PUBLIC_SUPABASE_URL"), trimEnv(env, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const projectId = trimEnv(env, "STAGING_CERT_PROJECT_ID");
  const orgId = trimEnv(env, "STAGING_CERT_ORG_ID");

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, organization_id, name, github_repo")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    result.releaseDecision = "NO-GO";
    result.error = projectError.message;
    return { exitCode: 1, result };
  }

  const projectValidation = validateCertificationProjectRecord(project, env);
  result.preconditions.projectScope = projectValidation;
  if (!projectValidation.ok) {
    result.releaseDecision = "NO-GO";
    result.error = projectValidation.errors.join("; ");
    return { exitCode: 1, result };
  }

  const scanJobId = jobCheck.scanJobId;
  const cert = await certifyJob(admin, {
    scanJobId,
    projectId,
    poll: cliArgs.poll,
    pollTimeoutMs: POLL_TIMEOUT_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  if (cert.job?.organization_id && cert.job.organization_id !== orgId) {
    result.releaseDecision = "NO-GO";
    result.error = "Scan job organization_id does not match certification org (cross-tenant blocked)";
    return { exitCode: 1, result };
  }

  result.scenarios[scenarioCheck.scenario] = cert;
  result.releaseDecision = cert.passed ? "GO" : "NO-GO";
  return { exitCode: cert.passed ? 0 : 1, result };
}

async function loadScanJob(admin, scanJobId) {
  const { data, error } = await admin.from("scan_jobs").select("*").eq("id", scanJobId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function pollUntilComplete(admin, scanJobId, pollTimeoutMs, pollIntervalMs) {
  const started = Date.now();
  while (Date.now() - started < pollTimeoutMs) {
    const job = await loadScanJob(admin, scanJobId);
    if (!job) throw new Error(`Scan job not found: ${scanJobId}`);
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Timed out after ${pollTimeoutMs}ms waiting for scan job ${scanJobId}`);
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

async function certifyJob(admin, { scanJobId, projectId, poll, pollTimeoutMs, pollIntervalMs }) {
  const checks = [];
  const job = poll
    ? await pollUntilComplete(admin, scanJobId, pollTimeoutMs, pollIntervalMs)
    : await loadScanJob(admin, scanJobId);
  if (!job) {
    return { passed: false, job: null, checks: [{ name: "scan_job", ok: false, detail: "not found" }] };
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

  const passed = checks.every((c) => c.ok);
  return {
    passed,
    checks,
    job,
    identifiers: platform?.ids ?? null,
    teamRunIds: platform?.teamRunIds ?? null,
    scanJobStatus: job.status,
    missionControl: mcSnapshot,
  };
}

export async function mainCertificationCli(mode, argv = process.argv.slice(2)) {
  const { exitCode, result } = await runPlatformConvergenceCertification({ mode, argv });
  console.log(JSON.stringify(result, null, 2));
  process.exit(exitCode);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
const thisFile = fileURLToPath(import.meta.url);
if (entry && entry === thisFile) {
  const mode = trimEnv(process.env, "PLATFORM_CONVERGENCE_CERT_MODE") === "main" ? "main" : "staging";
  mainCertificationCli(mode).catch((err) => {
    console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
}
