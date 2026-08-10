#!/usr/bin/env node
/**
 * Creates or replaces a staging attack authorization for the remote SequrAI security lab.
 *
 * Required environment variables (names only — never commit values):
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SEQURAI_STAGING_LAB_ORIGIN          e.g. https://sequrai-security-lab.vercel.app
 *   SEQURAI_STAGING_LAB_ORG_ID
 *   SEQURAI_STAGING_LAB_PROJECT_ID
 *
 * Optional:
 *   SEQURAI_STAGING_LAB_ENVIRONMENT     preview | staging (default: staging)
 *   SEQURAI_STAGING_LAB_REQUEST_BUDGET  default: 50
 *   SEQURAI_STAGING_LAB_MAX_DURATION_S  default: 300
 *   SEQURAI_STAGING_LAB_EXPIRES_HOURS   default: 168 (7 days)
 */
import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function normalizeOrigin(origin) {
  const url = new URL(origin);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Origin must be http or https");
  }
  return url.origin;
}

async function main() {
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const targetOrigin = normalizeOrigin(requireEnv("SEQURAI_STAGING_LAB_ORIGIN"));
  const organizationId = requireEnv("SEQURAI_STAGING_LAB_ORG_ID");
  const projectId = requireEnv("SEQURAI_STAGING_LAB_PROJECT_ID");
  const environmentType = process.env.SEQURAI_STAGING_LAB_ENVIRONMENT?.trim() || "staging";
  const maxRequestBudget = Number(process.env.SEQURAI_STAGING_LAB_REQUEST_BUDGET ?? "50");
  const maxDurationSeconds = Number(process.env.SEQURAI_STAGING_LAB_MAX_DURATION_S ?? "300");
  const expiresInHours = Number(process.env.SEQURAI_STAGING_LAB_EXPIRES_HOURS ?? "168");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = Date.now();
  const approvedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + expiresInHours * 60 * 60 * 1000).toISOString();

  const { data: existing } = await admin
    .from("attack_authorizations")
    .select("id, status, expires_at")
    .eq("organization_id", organizationId)
    .eq("project_id", projectId)
    .eq("target_origin", targetOrigin)
    .eq("status", "approved")
    .gt("expires_at", approvedAt)
    .maybeSingle();

  const row = {
    organization_id: organizationId,
    project_id: projectId,
    target_origin: targetOrigin,
    environment_type: environmentType,
    status: "approved",
    authorization_method: "remote_staging_lab_setup",
    approved_scope: {
      allowedPaths: ["/api", "/secure-headers", "/health", "/"],
    },
    created_by: "setup-remote-staging-lab-auth",
    approved_at: approvedAt,
    expires_at: expiresAt,
    test_credentials_ref: null,
    path_exclusions: [],
    redirect_allowlist: [],
    max_request_budget: maxRequestBudget,
    max_duration_seconds: maxDurationSeconds,
    commit_sha: null,
  };

  if (existing?.id) {
    const { error } = await admin.from("attack_authorizations").update(row).eq("id", existing.id);
    if (error) {
      console.error("Failed to update authorization:", error.message);
      process.exit(1);
    }
    console.log(
      JSON.stringify(
        {
          action: "updated",
          authorizationId: existing.id,
          targetOrigin,
          environmentType,
          expiresAt,
          allowedPaths: row.approved_scope.allowedPaths,
        },
        null,
        2
      )
    );
    return;
  }

  const { data, error } = await admin.from("attack_authorizations").insert(row).select("id").single();
  if (error || !data) {
    console.error("Failed to create authorization:", error?.message ?? "unknown");
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        action: "created",
        authorizationId: data.id,
        targetOrigin,
        environmentType,
        expiresAt,
        allowedPaths: row.approved_scope.allowedPaths,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
