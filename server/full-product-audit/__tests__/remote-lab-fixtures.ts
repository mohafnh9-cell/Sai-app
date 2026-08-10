import { E2E_ORG_ID, E2E_PROJECT_ID } from "./e2e-harness";

export function buildStagingLabAuthorization(origin: string) {
  const now = Date.now();
  const normalized = new URL(origin).origin;
  return {
    id: "77777777-7777-4777-8777-777777777777",
    organization_id: E2E_ORG_ID,
    project_id: E2E_PROJECT_ID,
    target_origin: normalized,
    environment_type: "staging" as const,
    status: "approved" as const,
    authorization_method: "remote_staging_lab",
    approved_scope: {
      allowedPaths: ["/api", "/secure-headers", "/health", "/"],
    },
    created_by: "staging-lab-setup",
    approved_at: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 7 * 24 * 3_600_000).toISOString(),
    test_credentials_ref: null,
    path_exclusions: [],
    redirect_allowlist: [],
    max_request_budget: 50,
    max_duration_seconds: 300,
    commit_sha: null,
  };
}

export { buildEvilAuthorization } from "./e2e-harness";
