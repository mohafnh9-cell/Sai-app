import { describe, expect, it, vi } from "vitest";
import type { McpAuthContext } from "@/server/mcp/auth";
import { McpError } from "@/server/mcp/auth";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { reviewNow } from "@/server/mcp/tools/review-now";
import { MCP_REVIEWS_PER_ORGANIZATION_PER_HOUR } from "@/server/review-now/rate-limit";
import { createFakeAdmin, type FakeTables } from "./fake-admin";
import { buildVerdictFixture, verdictRow } from "./verdict-fixture";

const ORG_A = "org-a";
const ORG_B = "org-b";
const PROJECT_1 = "11111111-1111-4111-8111-111111111111";
const PROJECT_2 = "22222222-2222-4222-8222-222222222222";

function ctxFor(admin: ReturnType<typeof createFakeAdmin>, organizationId = ORG_A): McpAuthContext {
  return {
    keyId: "key-1",
    organizationId,
    userId: "user-1",
    admin: admin as unknown as McpAuthContext["admin"],
  };
}

function baseTables(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    projects: [
      {
        id: PROJECT_1,
        name: "Alpha",
        github_repo: "acme/alpha",
        github_repository_id: 42,
        organization_id: ORG_A,
        created_at: "2026-01-01",
      },
    ],
    scans: [],
    repository_scan_state: [],
    production_verdicts: [],
    ...overrides,
  };
}

const t = getMcpTranslator("en");

const okDeps = {
  resolveToken: async () => ({ token: "gh-token", userId: "user-1" }),
  resolveCommit: async () => ({ sha: "new-sha", branch: "main" }),
  runScan: vi.fn().mockResolvedValue(undefined),
  scheduleBackground: vi.fn(),
};

describe("review_now", () => {
  it("returns a queued production_review_request response with a reviewId, quickly, without waiting for the scan", async () => {
    const tables = baseTables();
    const result = await reviewNow(ctxFor(createFakeAdmin(tables)), {}, t, okDeps);

    expect(result.mode).toBe("production_review_request");
    expect(result.status).toBe("queued");
    expect(result.duplicate).toBe(false);
    expect(result.reviewId).toBeTruthy();
    expect(result.commitSha).toBe("new-sha");
    expect(result.nextAction).toBe(t("reviewNow.queuedNext"));
    expect(result.summary).toContain("SEQURAI");
    expect(result.summary).toContain(t("modes.production_review_request"));
    expect(okDeps.scheduleBackground).toHaveBeenCalled();
  });

  it("persists the review with source mcp_manual (trigger_type=mcp, review_type=manual)", async () => {
    const tables = baseTables();
    await reviewNow(ctxFor(createFakeAdmin(tables)), {}, t, okDeps);
    expect(tables.scans).toHaveLength(1);
    expect(tables.scans[0]).toMatchObject({ trigger_type: "mcp", review_type: "manual" });
  });

  it("accepts an explicit commitSha and reviews that exact commit", async () => {
    const tables = baseTables();
    const resolveCommit = vi.fn().mockResolvedValue({ sha: "explicit-sha", branch: null });
    const result = await reviewNow(
      ctxFor(createFakeAdmin(tables)),
      { commitSha: "explicit-sha" },
      t,
      { ...okDeps, resolveCommit }
    );
    expect(result.commitSha).toBe("explicit-sha");
    expect(resolveCommit).toHaveBeenCalledWith(
      "gh-token",
      { owner: "acme", repo: "alpha" },
      { commitSha: "explicit-sha", branch: undefined }
    );
  });

  it("returns status=processing and duplicate=true when a review is already active for the repository", async () => {
    const tables = baseTables({
      scans: [
        {
          id: "scan-active",
          repository_id: PROJECT_1,
          organization_id: ORG_A,
          status: "scanning",
          created_at: new Date().toISOString(),
        },
      ],
    });
    const result = await reviewNow(ctxFor(createFakeAdmin(tables)), {}, t, okDeps);
    expect(result.status).toBe("processing");
    expect(result.duplicate).toBe(true);
    expect(result.reviewId).toBe("scan-active");
    expect(tables.scans).toHaveLength(1);
  });

  it("returns status=already_completed and duplicate=true when the current verdict already covers the resolved commit", async () => {
    const verdict = buildVerdictFixture({ commitSha: "new-sha", status: "ready_to_ship", score: 92 });
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await reviewNow(ctxFor(createFakeAdmin(tables)), {}, t, okDeps);
    expect(result.status).toBe("already_completed");
    expect(result.duplicate).toBe(true);
    expect(result.verdictStatus).toBe("ready_to_ship");
    expect(result.score).toBe(92);
    expect(result.reviewedCommitSha).toBe("new-sha");
    expect(tables.scans).toHaveLength(0);
  });

  it("throws repository_disconnected when the project has no GitHub repository connected", async () => {
    const tables = baseTables({
      projects: [
        {
          id: PROJECT_1,
          name: "Alpha",
          github_repo: null,
          github_repository_id: null,
          organization_id: ORG_A,
          created_at: "2026-01-01",
        },
      ],
    });
    await expect(reviewNow(ctxFor(createFakeAdmin(tables)), {}, t, okDeps)).rejects.toMatchObject({
      code: "repository_disconnected",
    });
  });

  it("throws commit_not_found for an explicit commitSha that does not exist on the repository", async () => {
    const tables = baseTables();
    const { GitHubServiceError } = await import("@/lib/github/repository-service");
    const resolveCommit = vi.fn().mockRejectedValue(new GitHubServiceError("GITHUB_NOT_FOUND", "not found", 404));

    await expect(
      reviewNow(ctxFor(createFakeAdmin(tables)), { commitSha: "missing" }, t, { ...okDeps, resolveCommit })
    ).rejects.toMatchObject({ code: "commit_not_found" });
  });

  it("throws project_not_found for a project outside the caller's organization (tenant isolation)", async () => {
    const tables = baseTables();
    await expect(
      reviewNow(ctxFor(createFakeAdmin(tables), ORG_B), { projectId: PROJECT_1 }, t, okDeps)
    ).rejects.toMatchObject({ code: "project_not_found" });
  });

  it("returns ambiguous_project when multiple projects exist and none is specified", async () => {
    const tables = baseTables({
      projects: [
        {
          id: PROJECT_1,
          name: "Alpha",
          github_repo: "acme/alpha",
          github_repository_id: 42,
          organization_id: ORG_A,
          created_at: "2026-01-01",
        },
        {
          id: PROJECT_2,
          name: "Beta",
          github_repo: "acme/beta",
          github_repository_id: 43,
          organization_id: ORG_A,
          created_at: "2026-01-02",
        },
      ],
    });
    await expect(reviewNow(ctxFor(createFakeAdmin(tables)), {}, t, okDeps)).rejects.toMatchObject({
      code: "ambiguous_project",
    });
  });

  it("auto-selects the single project when the organization has exactly one", async () => {
    const tables = baseTables();
    const result = await reviewNow(ctxFor(createFakeAdmin(tables)), {}, t, okDeps);
    expect(result.project.id).toBe(PROJECT_1);
  });

  it("rate-limits after the per-organization hourly review cap is reached", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousEnabled = process.env.SCAN_RATE_LIMIT_ENABLED;
    const previousDisabled = process.env.SCAN_RATE_LIMIT_DISABLED;
    process.env.NODE_ENV = "production";
    process.env.SCAN_RATE_LIMIT_ENABLED = "1";
    delete process.env.SCAN_RATE_LIMIT_DISABLED;
    const recentScans = Array.from({ length: MCP_REVIEWS_PER_ORGANIZATION_PER_HOUR }, (_, i) => ({
      id: `scan-${i}`,
      organization_id: ORG_A,
      repository_id: PROJECT_1,
      trigger_type: "mcp",
      status: "completed",
      created_at: new Date().toISOString(),
    }));
    const tables = baseTables({ scans: recentScans });
    try {
      await expect(reviewNow(ctxFor(createFakeAdmin(tables)), {}, t, okDeps)).rejects.toMatchObject({
        code: "rate_limited",
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousEnabled == null) delete process.env.SCAN_RATE_LIMIT_ENABLED;
      else process.env.SCAN_RATE_LIMIT_ENABLED = previousEnabled;
      if (previousDisabled == null) delete process.env.SCAN_RATE_LIMIT_DISABLED;
      else process.env.SCAN_RATE_LIMIT_DISABLED = previousDisabled;
    }
  });

  it("responds in Spanish when locale=es is requested", async () => {
    const tables = baseTables();
    const es = getMcpTranslator("es");
    const result = await reviewNow(ctxFor(createFakeAdmin(tables)), {}, es, okDeps);
    expect(result.summary).toContain("SEQURAI");
    expect(result.summary).toContain(es("modes.production_review_request"));
  });
});
