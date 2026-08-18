import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
import type { TriggerReviewDependencies } from "@/server/review-now/trigger-review";

export const E2E_ORG_ID = "66666666-6666-4666-8666-666666666666";
export const E2E_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
export const E2E_SCAN_ID = "11111111-1111-4111-8111-111111111111";
export const E2E_SCAN_JOB_ID = "22222222-2222-4222-8222-222222222222";
export const E2E_COMMIT_SHA = "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b";

export function buildReviewDeps(): TriggerReviewDependencies {
  return {
    resolveToken: async () => ({ token: "gh-token", userId: "user-1" }),
    resolveCommit: async () => ({ sha: E2E_COMMIT_SHA, branch: "main" }),
  };
}

export function createFullProductAuditE2EAdmin(options?: {
  attackAuthorizations?: FakeTables["attack_authorizations"];
  dynamicTargetVerifications?: FakeTables["dynamic_target_verifications"];
  scanFindings?: FakeTables["scan_findings"];
}): { admin: ReturnType<typeof createFakeAdmin>; tables: FakeTables } {
  const now = new Date().toISOString();
  const defaultFinding = {
    id: "finding-idor-1",
    scan_id: E2E_SCAN_ID,
    rule_id: "authz.insufficient",
    title: "Possible cross-tenant authorization weakness",
    description: "Route may allow access without tenant ownership validation.",
    severity: "high",
    category: "authorization",
    file_path: "app/api/orders/[id]/route.ts",
    recommendation: "Enforce tenant-scoped authorization.",
    confidence: "high",
    evidence: "No visible ownership check on resource fetch.",
    created_at: now,
  };
  const verdict = buildVerdictFixture({
    projectId: E2E_PROJECT_ID,
    repositoryId: E2E_PROJECT_ID,
    scanId: E2E_SCAN_ID,
    commitSha: E2E_COMMIT_SHA,
    status: "not_ready",
    score: 58,
    findingsCount: 1,
  });
  const verdictDbRow = verdictRow(
    E2E_PROJECT_ID,
    verdict,
    "99999999-9999-4999-8999-999999999999",
    E2E_ORG_ID
  );

  const tables: FakeTables = {
    projects: [
      {
        id: E2E_PROJECT_ID,
        name: "Dynamic Security E2E Lab",
        organization_id: E2E_ORG_ID,
        github_repo: "sequrai/dynamic-security-e2e",
        github_repository_id: 4242,
        github_last_commit_sha: E2E_COMMIT_SHA,
        created_at: now,
        updated_at: now,
      },
    ],
    scans: [
      {
        id: E2E_SCAN_ID,
        organization_id: E2E_ORG_ID,
        project_id: E2E_PROJECT_ID,
        repository_id: E2E_PROJECT_ID,
        status: "completed",
        commit_sha: E2E_COMMIT_SHA,
        branch: "main",
        trigger_type: "mcp",
        review_type: "manual",
        completed_at: now,
        created_at: now,
        updated_at: now,
        metrics: { rulesRun: 22 },
      },
    ],
    scan_findings: options?.scanFindings ?? [defaultFinding],
    scan_jobs: [
      {
        id: E2E_SCAN_JOB_ID,
        scan_id: E2E_SCAN_ID,
        project_id: E2E_PROJECT_ID,
        organization_id: E2E_ORG_ID,
        status: "completed",
        completed_at: now,
        created_at: now,
        metadata: {},
      },
    ],
    production_verdicts: [verdictDbRow],
    repository_scan_state: [
      {
        repository_id: E2E_PROJECT_ID,
        organization_id: E2E_ORG_ID,
        current_verdict_id: verdictDbRow.id,
        active_scan_id: null,
      },
    ],
    attack_authorizations: options?.attackAuthorizations ?? [],
    dynamic_target_verifications: options?.dynamicTargetVerifications ?? [],
    attack_simulation_campaigns: [],
    attack_simulation_scenarios: [],
    attack_simulation_executions: [],
    attack_simulation_execution_steps: [],
    attack_simulation_findings: [],
    attack_simulation_evidence: [],
    attack_simulation_runtime_events: [],
    attack_simulation_execution_plans: [],
    attack_simulation_mitigations: [],
    attack_simulation_safe_fixes: [],
  };

  return { admin: createFakeAdmin(tables), tables };
}

export function buildEvilAuthorization(origin = "https://evil.example.com") {
  const now = Date.now();
  return {
    id: "88888888-8888-4888-8888-888888888888",
    organization_id: E2E_ORG_ID,
    project_id: E2E_PROJECT_ID,
    target_origin: origin,
    environment_type: "staging",
    status: "approved",
    authorization_method: "e2e",
    approved_scope: { allowedPaths: ["/admin-only"] },
    created_by: "user-1",
    approved_at: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 3_600_000).toISOString(),
    test_credentials_ref: null,
    path_exclusions: [],
    redirect_allowlist: [],
    max_request_budget: 20,
    max_duration_seconds: 300,
    commit_sha: null,
  };
}
