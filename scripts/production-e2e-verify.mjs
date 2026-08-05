#!/usr/bin/env node
/**
 * Production E2E verification against deployed Vercel app.
 * Uses Supabase admin to obtain a real user session, then exercises HTTP flows.
 */
import { createAdminScriptClient } from "./lib/supabase-admin.mjs";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_URL = process.env.PRODUCTION_URL ?? "https://sequrai-app.vercel.app";
const NEVER_ANALYZED_PROJECT_ID =
  process.env.E2E_NEVER_ANALYZED_PROJECT_ID ?? "c3204273-eb0c-4ddc-b3a6-474f10a6d697";
const SEQURAI_PROJECT_ID =
  process.env.E2E_PROJECT_ID ?? "2bd1e005-56c8-4aef-9c72-ed1d444467ed";
const POLL_MS = 4000;
const SCAN_TIMEOUT_MS = 240_000;
const SECURITY_TIMEOUT_MS = 180_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(step, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${step}${detail ? `: ${detail}` : ""}`);
}

async function authenticateProductionSession() {
  const admin = createAdminScriptClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  const { data: project } = await admin
    .from("projects")
    .select("organization_id")
    .eq("id", NEVER_ANALYZED_PROJECT_ID)
    .maybeSingle();
  if (!project?.organization_id) throw new Error("Never-analyzed project not found");

  const { data: member } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", project.organization_id)
    .limit(1)
    .maybeSingle();
  if (!member?.user_id) throw new Error("No org member for auth");

  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", member.user_id)
    .maybeSingle();
  if (!profile?.email) throw new Error("No profile email for auth");

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkError?.message ?? "no token"}`);
  }

  const anon = createClient(supabaseUrl, anonKey);
  const { data: otpData, error: otpError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (otpError || !otpData.session) {
    throw new Error(`verifyOtp failed: ${otpError?.message ?? "no session"}`);
  }

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = encodeURIComponent(
    JSON.stringify({
      access_token: otpData.session.access_token,
      refresh_token: otpData.session.refresh_token,
      expires_at: otpData.session.expires_at,
      expires_in: otpData.session.expires_in,
      token_type: "bearer",
      user: otpData.session.user,
    })
  );

  return {
    admin,
    cookieHeader: `${cookieName}=${cookieValue}`,
    userId: member.user_id,
  };
}

async function productionFetch(path, options = {}) {
  const started = Date.now();
  const response = await fetch(`${PRODUCTION_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      cookie: options.cookieHeader ?? "",
    },
    redirect: "manual",
  });
  const latencyMs = Date.now() - started;
  let body = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    body = await response.json().catch(() => null);
  } else {
    body = await response.text().catch(() => null);
  }
  return { response, body, latencyMs };
}

async function waitForScanVerdict(admin, scanId) {
  const started = Date.now();
  while (Date.now() - started < SCAN_TIMEOUT_MS) {
    const { data: scan } = await admin
      .from("scans")
      .select("id, status, progress, progress_message")
      .eq("id", scanId)
      .maybeSingle();
    const { data: verdict } = await admin
      .from("production_verdicts")
      .select("id")
      .eq("scan_id", scanId)
      .maybeSingle();
    if (scan?.status === "completed" && verdict?.id) {
      return { scan, verdictId: verdict.id };
    }
    if (scan?.status === "failed") {
      throw new Error(`Scan failed: ${scan.progress_message ?? scan.status}`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Scan timeout for ${scanId}`);
}

async function main() {
  console.log(`Production E2E → ${PRODUCTION_URL}`);
  const { admin, cookieHeader } = await authenticateProductionSession();
  log("AUTH session", true);

  // FLOW 1 — never analyzed project MC state
  const mc1 = await productionFetch(
    `/api/projects/${NEVER_ANALYZED_PROJECT_ID}/mission-control`,
    { cookieHeader }
  );
  log(
    "FLOW1 GET mission-control",
    mc1.response.status === 200,
    `${mc1.response.status} ${mc1.latencyMs}ms`
  );
  if (mc1.response.status !== 200) {
    throw new Error(`FLOW1 blocked: ${mc1.response.status} ${JSON.stringify(mc1.body)}`);
  }
  const state1 = mc1.body;
  log(
    "FLOW1 never analyzed UI state",
    !state1.status?.hasVerdict && state1.actions?.scan?.label === "cta",
    `hasVerdict=${state1.status?.hasVerdict} scanLabel=${state1.actions?.scan?.label}`
  );

  // FLOW 2 — first scan on never-analyzed project
  const scanPost = await productionFetch(
    `/api/projects/${NEVER_ANALYZED_PROJECT_ID}/analysis-runs`,
    {
      method: "POST",
      cookieHeader,
      headers: { "Content-Type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ forceNew: true }),
    }
  );
  log(
    "FLOW2 POST analysis-runs",
    scanPost.response.status >= 200 && scanPost.response.status < 300,
    `${scanPost.response.status} ${scanPost.latencyMs}ms`
  );
  const scanId =
    scanPost.body?.runId ?? scanPost.body?.scanId ?? scanPost.body?.scan?.id ?? null;
  log("FLOW2 scan created", Boolean(scanId), scanId ?? JSON.stringify(scanPost.body));

  const { data: jobRow } = await admin
    .from("scan_jobs")
    .select("id, status")
    .eq("scan_id", scanId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  log("FLOW2 scan job", Boolean(jobRow?.id), jobRow?.id ?? "missing");

  const { verdictId } = await waitForScanVerdict(admin, scanId);
  log("FLOW2 production verdict", true, verdictId);

  const mc2 = await productionFetch(
    `/api/projects/${NEVER_ANALYZED_PROJECT_ID}/mission-control?run=${scanId}`,
    { cookieHeader }
  );
  const state2 = mc2.body;
  log(
    "FLOW2 MC refreshed",
    state2.status?.hasVerdict && state2.actions?.scan?.label === "rescan",
    `hasVerdict=${state2.status?.hasVerdict} label=${state2.actions?.scan?.label}`
  );
  log(
    "FLOW2 header/selector consistent",
    Boolean(state2.status?.lastAnalysisAt) && state2.status?.hasCompletedAnalysis,
    `lastAnalysisAt=${state2.status?.lastAnalysisAt}`
  );

  // FLOW 3 — re-scan
  const rescanPost = await productionFetch(
    `/api/projects/${NEVER_ANALYZED_PROJECT_ID}/analysis-runs`,
    {
      method: "POST",
      cookieHeader,
      headers: { "Content-Type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ forceNew: true }),
    }
  );
  const rescanId =
    rescanPost.body?.runId ?? rescanPost.body?.scanId ?? rescanPost.body?.scan?.id ?? null;
  log(
    "FLOW3 new scan",
    Boolean(rescanId) && rescanId !== scanId,
    `${rescanId} (prev ${scanId})`
  );
  const { verdictId: rescanVerdictId } = await waitForScanVerdict(admin, rescanId);
  log(
    "FLOW3 new verdict",
    rescanVerdictId !== verdictId,
    `${rescanVerdictId} (prev ${verdictId})`
  );

  // FLOW 4 — security on same project (now has completed scans)
  const testIds = [
    "idor-cross-tenant",
    "unauthenticated-endpoint",
    "workflow-bypass",
    "webhook-signature-bypass",
  ];
  const secPost = await productionFetch(
    `/api/projects/${NEVER_ANALYZED_PROJECT_ID}/security-tests`,
    {
      method: "POST",
      cookieHeader,
      headers: { "Content-Type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ testIds, analysisRunId: rescanId }),
    }
  );
  const flow4Ok = secPost.response.status >= 200 && secPost.response.status < 300;
  log(
    "FLOW4 POST security-tests",
    flow4Ok,
    `${secPost.response.status} ${JSON.stringify(secPost.body)?.slice(0, 200)}`
  );
  if (!flow4Ok) {
    throw new Error(`FLOW4 failed: ${secPost.response.status} ${JSON.stringify(secPost.body)}`);
  }
  const campaignId = secPost.body?.campaignId ?? null;
  log("FLOW4 campaign", Boolean(campaignId), campaignId ?? "");

  const startedSec = Date.now();
  let finalCampaign = null;
  while (Date.now() - startedSec < SECURITY_TIMEOUT_MS) {
    const { data: camp } = await admin
      .from("attack_simulation_campaigns")
      .select("id, status, completed_at")
      .eq("id", campaignId)
      .maybeSingle();
    finalCampaign = camp;
    if (camp?.status === "completed" || camp?.status === "failed") break;
    await sleep(POLL_MS);
  }
  log(
    "FLOW4 campaign completed",
    finalCampaign?.status === "completed",
    `${finalCampaign?.status} at ${finalCampaign?.completed_at ?? "—"}`
  );
  if (finalCampaign?.status !== "completed") {
    throw new Error(`FLOW4 campaign not completed: ${finalCampaign?.status ?? "missing"}`);
  }

  const { data: findings } = await admin
    .from("attack_simulation_findings")
    .select("id")
    .eq("campaign_id", campaignId);
  log("FLOW4 findings", (findings?.length ?? 0) > 0, `${findings?.length ?? 0} rows`);
  if (!findings?.length) {
    throw new Error("FLOW4 no findings persisted");
  }

  console.log("\nALL PRODUCTION FLOWS PASSED");
}

main().catch((error) => {
  console.error("\nPRODUCTION E2E FAILED:", error.message);
  process.exit(1);
});
