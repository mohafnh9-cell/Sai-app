import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { executeMcpTool } from "@/server/mcp/execute-tool";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
import { testMcpAuthContext } from "@/server/mcp/__tests__/test-context";
import { evaluateDeployDecisionAlert } from "../evaluate-deploy-decision";

// Reading the deploy answer (mcp:status:read) must not create a visible alert. The alert is evaluated from the SAME
// canonical decision by the scheduled per-project evaluation, once per decision.

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";

function world() {
  const verdict = buildVerdictFixture({ status: "not_ready", score: 64, blockersCount: 2 });
  const row = verdictRow(PROJECT, verdict);
  const tables = {
    projects: [{ id: PROJECT, name: "Alpha", github_repo: "acme/alpha", organization_id: ORG, created_at: "2026-01-01" }],
    production_verdicts: [row],
    repository_scan_state: [{ repository_id: PROJECT, current_verdict_id: row.id }],
    github_webhooks: [{ project_id: PROJECT, active: true, callback_url: null, last_delivery_at: "2026-01-01T00:00:00.000Z" }],
    repository_sync_status: [{ project_id: PROJECT, commit_sha: null, connection_status: "connected", last_error: null }],
    scan_findings: [], scans: [], profiles: [],
    security_alerts: [], security_alert_events: [], protection_events: [], project_memory_profile: [],
  } as unknown as FakeTables;
  const admin = createFakeAdmin(tables);
  return { tables, admin };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
const alerts = (tables: FakeTables) => (tables.security_alerts ?? []) as Array<Record<string, unknown>>;

describe("the deploy-check alert has a scheduled owner; can_i_deploy only reads", () => {
  it("can_i_deploy answers and creates no alert, however often it is asked", async () => {
    const { tables, admin } = world();
    const ctx = testMcpAuthContext(admin, { organizationId: ORG });
    for (let i = 0; i < 3; i++) {
      const result = (await executeMcpTool(ctx, "can_i_deploy", { projectId: PROJECT })) as { deploymentRecommendation: string };
      expect(result.deploymentRecommendation).toBe("DO_NOT_DEPLOY");
    }
    await flush();
    expect(alerts(tables)).toHaveLength(0);
    expect(tables.security_alert_events ?? []).toHaveLength(0);
  });

  it("the scheduled evaluation creates the alert from the same canonical decision, bound to the scan, and is idempotent", async () => {
    const { tables, admin } = world();
    expect(await evaluateDeployDecisionAlert(admin as never, PROJECT)).toEqual({ evaluated: true });
    expect(alerts(tables)).toHaveLength(1);
    expect(alerts(tables)[0]).toMatchObject({ alert_kind: "deploy_blocked", project_id: PROJECT, organization_id: ORG });
    expect(String(alerts(tables)[0].dedupe_key)).toMatch(new RegExp(`^${PROJECT}:deploy_blocked:.+:safe_fix$`));

    await evaluateDeployDecisionAlert(admin as never, PROJECT);
    expect(alerts(tables)).toHaveLength(1);
  });

  it("a project with no verdict, or an unknown project, evaluates nothing and creates nothing", async () => {
    const { tables, admin } = world();
    tables.production_verdicts = [];
    tables.repository_scan_state = [];
    expect(await evaluateDeployDecisionAlert(admin as never, PROJECT)).toEqual({ evaluated: false });
    expect(await evaluateDeployDecisionAlert(admin as never, "99999999-9999-4999-8999-999999999999")).toEqual({ evaluated: false });
    expect(alerts(tables)).toHaveLength(0);
  });
});
