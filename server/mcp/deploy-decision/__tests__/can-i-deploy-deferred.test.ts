import { describe, expect, it } from "vitest";
import type { McpAuthContext } from "@/server/mcp/auth";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { canIDeploy } from "@/server/mcp/tools/can-i-deploy";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
import { REVIEW_STALE_FAILURE_CODE } from "@/server/review-recovery/stale-review";

const ORG_A = "org-a";
const PROJECT_1 = "11111111-1111-4111-8111-111111111111";

function ctxFor(admin: ReturnType<typeof createFakeAdmin>): McpAuthContext {
  return {
    keyId: "key-1",
    organizationId: ORG_A,
    userId: "user-1",
    admin: admin as unknown as McpAuthContext["admin"],
  };
}

function baseTables(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    projects: [
      { id: PROJECT_1, name: "Alpha", github_repo: "acme/alpha", organization_id: ORG_A, created_at: "2026-01-01" },
    ],
    production_verdicts: [],
    repository_scan_state: [],
    github_webhooks: [
      { project_id: PROJECT_1, active: true, callback_url: null, last_delivery_at: "2026-01-01T00:00:00.000Z" },
    ],
    repository_sync_status: [
      { project_id: PROJECT_1, commit_sha: null, connection_status: "connected", last_error: null },
    ],
    scan_findings: [],
    scans: [],
    profiles: [],
    ...overrides,
  };
}

const t = getMcpTranslator("en");

describe("can_i_deploy deferred deploy decision", () => {
  it("does not emit YES/NO when the newest review is queued", async () => {
    const verdict = buildVerdictFixture({ commitSha: "dbfffe1", status: "needs_improvement", score: 65 });
    const tables = baseTables({
      production_verdicts: [verdictRow(PROJECT_1, verdict)],
      scans: [
        {
          id: "queued-new",
          repository_id: PROJECT_1,
          status: "queued",
          commit_sha: "5ff918c",
          created_at: "2026-07-25T16:08:00.000Z",
        },
      ],
    });

    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    expect(result.summary).toContain("currently reviewing commit 5ff918c");
    expect(result.summary).toContain("historical");
    expect(result.summary).toContain("dbfffe1");
    expect(result.summary).not.toContain("NO.");
    expect(result.summary).not.toContain("YES.");
    expect(result.reviewInProgress).toBe(true);
    expect(result.latestReviewId).toBe("queued-new");
  });

  it("issues DO NOT DEPLOY when the newest review completed and matches the verdict", async () => {
    const scanId = "22222222-2222-4222-8222-222222222221";
    const verdict = buildVerdictFixture({
      commitSha: "done111",
      status: "not_ready",
      score: 64,
      scanId,
    });
    const verdictDbRow = verdictRow(PROJECT_1, verdict);
    const tables = baseTables({
      production_verdicts: [verdictDbRow],
      repository_scan_state: [
        {
          repository_id: PROJECT_1,
          current_verdict_id: verdictDbRow.id,
        },
      ],
      scans: [
        {
          id: scanId,
          project_id: PROJECT_1,
          repository_id: PROJECT_1,
          status: "completed",
          commit_sha: "done111",
          branch: "main",
          security_score: 64,
          files_analyzed: 40,
          files_discovered: 40,
          completed_at: "2026-07-25T16:00:00.000Z",
          created_at: "2026-07-25T16:00:00.000Z",
        },
      ],
      scan_findings: [
        {
          id: "finding-1",
          scan_id: scanId,
          rule_id: "auth.missing-guard",
          title: "Protect the administrative endpoint",
          severity: "critical",
          category: "authorization",
          file_path: "app/api/admin/route.ts",
          recommendation: "Add an authorization check.",
          confidence: "high",
        },
        {
          id: "finding-2",
          scan_id: scanId,
          rule_id: "api.missing-rate-limit",
          title: "Add rate limiting to the public API",
          severity: "high",
          category: "availability",
          file_path: "app/api/public/route.ts",
          recommendation: "Add rate limiting middleware.",
          confidence: "medium",
        },
      ],
    });

    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.deploymentRecommendation).toBe("DO_NOT_DEPLOY");
    expect(result.summary).toContain("NO.");
  });

  it("defers when the newest review failed with a timeout", async () => {
    const verdict = buildVerdictFixture({ commitSha: "old1111", status: "needs_improvement", score: 65 });
    const tables = baseTables({
      production_verdicts: [verdictRow(PROJECT_1, verdict)],
      scans: [
        {
          id: "failed-scan",
          repository_id: PROJECT_1,
          status: "failed",
          commit_sha: "stuck222",
          error_code: REVIEW_STALE_FAILURE_CODE,
          created_at: "2026-07-25T15:00:00.000Z",
        },
      ],
    });

    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    expect(result.summary).toContain("timed out");
    expect(result.summary).not.toContain("NO.");
  });
});
