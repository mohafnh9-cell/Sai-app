import { describe, expect, it, vi } from "vitest";
import { GitHubServiceError } from "@/lib/github/repository-service";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
import { ReviewNowError, triggerProductionReview } from "../trigger-review";

const ORG_A = "org-a";
const PROJECT_1 = "11111111-1111-4111-8111-111111111111";

function baseTables(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    scans: [],
    repository_scan_state: [],
    production_verdicts: [],
    ...overrides,
  };
}

const okToken = async () => ({ token: "gh-token", userId: "user-1" });
const noToken = async () => null;

function okCommit(sha = "new-sha", branch = "main") {
  return async () => ({ sha, branch });
}

describe("triggerProductionReview", () => {
  it("throws repository_disconnected when the project has no connected GitHub repository", async () => {
    const admin = createFakeAdmin(baseTables());
    await expect(
      triggerProductionReview(
        admin as never,
        { organizationId: ORG_A, projectId: PROJECT_1, githubRepo: null, githubRepositoryId: null },
        { resolveToken: okToken, resolveCommit: okCommit(), runScan: vi.fn() }
      )
    ).rejects.toBeInstanceOf(ReviewNowError);
  });

  it("throws repository_disconnected when no organization member has a valid GitHub token", async () => {
    const admin = createFakeAdmin(baseTables());
    await expect(
      triggerProductionReview(
        admin as never,
        {
          organizationId: ORG_A,
          projectId: PROJECT_1,
          githubRepo: "acme/alpha",
          githubRepositoryId: 42,
        },
        { resolveToken: noToken, resolveCommit: okCommit(), runScan: vi.fn() }
      )
    ).rejects.toMatchObject({ code: "repository_disconnected" });
  });

  it("throws commit_not_found when an explicit commitSha does not exist on GitHub", async () => {
    const admin = createFakeAdmin(baseTables());
    const resolveCommit = async () => {
      throw new GitHubServiceError("GITHUB_NOT_FOUND", "not found", 404);
    };
    await expect(
      triggerProductionReview(
        admin as never,
        {
          organizationId: ORG_A,
          projectId: PROJECT_1,
          githubRepo: "acme/alpha",
          githubRepositoryId: 42,
          requestedCommitSha: "does-not-exist",
        },
        { resolveToken: okToken, resolveCommit, runScan: vi.fn() }
      )
    ).rejects.toMatchObject({ code: "commit_not_found" });
  });

  it("resolves the latest commit on the default branch when no commitSha is given", async () => {
    const admin = createFakeAdmin(baseTables());
    const runScan = vi.fn().mockResolvedValue(undefined);
    const result = await triggerProductionReview(
      admin as never,
      { organizationId: ORG_A, projectId: PROJECT_1, githubRepo: "acme/alpha", githubRepositoryId: 42 },
      { resolveToken: okToken, resolveCommit: okCommit("latest-sha", "main"), runScan, scheduleBackground: vi.fn() }
    );
    expect(result).toMatchObject({ outcome: "queued", commitSha: "latest-sha", branch: "main" });
  });

  it("creates a scan row marked as trigger_type=mcp, review_type=manual (source: mcp_manual)", async () => {
    const tables = baseTables();
    const admin = createFakeAdmin(tables);
    const runScan = vi.fn().mockResolvedValue(undefined);
    await triggerProductionReview(
      admin as never,
      { organizationId: ORG_A, projectId: PROJECT_1, githubRepo: "acme/alpha", githubRepositoryId: 42 },
      { resolveToken: okToken, resolveCommit: okCommit(), runScan, scheduleBackground: vi.fn() }
    );
    expect(tables.scans).toHaveLength(1);
    expect(tables.scans[0]).toMatchObject({
      trigger_type: "mcp",
      review_type: "manual",
      status: "queued",
      commit_sha: "new-sha",
      organization_id: ORG_A,
      repository_id: PROJECT_1,
    });
  });

  it("schedules the scan to run in the background rather than blocking the response", async () => {
    const admin = createFakeAdmin(baseTables());
    const scheduleBackground = vi.fn();
    const runScan = vi.fn().mockResolvedValue(undefined);
    await triggerProductionReview(
      admin as never,
      { organizationId: ORG_A, projectId: PROJECT_1, githubRepo: "acme/alpha", githubRepositoryId: 42 },
      { resolveToken: okToken, resolveCommit: okCommit(), runScan, scheduleBackground }
    );
    expect(scheduleBackground).toHaveBeenCalledTimes(1);
    expect(runScan).not.toHaveBeenCalled(); // only invoked once scheduleBackground actually runs its callback
  });

  it("returns processing + duplicate semantics when a review is already active for the repository", async () => {
    const fresh = new Date().toISOString();
    const tables = baseTables({
      scans: [
        {
          id: "scan-active",
          repository_id: PROJECT_1,
          organization_id: ORG_A,
          status: "scanning",
          commit_sha: "new-sha",
          created_at: fresh,
          updated_at: fresh,
          started_at: fresh,
        },
      ],
    });
    const admin = createFakeAdmin(tables);
    const runScan = vi.fn();
    const result = await triggerProductionReview(
      admin as never,
      { organizationId: ORG_A, projectId: PROJECT_1, githubRepo: "acme/alpha", githubRepositoryId: 42 },
      { resolveToken: okToken, resolveCommit: okCommit(), runScan, scheduleBackground: vi.fn() }
    );
    expect(result).toEqual({ outcome: "processing", reviewId: "scan-active" });
    expect(runScan).not.toHaveBeenCalled();
    // no second scan row was created
    expect(tables.scans).toHaveLength(1);
  });

  it("supersedes an active review on an older commit and queues a new review", async () => {
    const fresh = new Date().toISOString();
    const tables = baseTables({
      scans: [
        {
          id: "scan-active",
          repository_id: PROJECT_1,
          organization_id: ORG_A,
          status: "scanning",
          commit_sha: "old-sha",
          created_at: fresh,
          updated_at: fresh,
          started_at: fresh,
        },
      ],
    });
    const admin = createFakeAdmin(tables);
    const runScan = vi.fn().mockResolvedValue(undefined);
    const result = await triggerProductionReview(
      admin as never,
      { organizationId: ORG_A, projectId: PROJECT_1, githubRepo: "acme/alpha", githubRepositoryId: 42 },
      { resolveToken: okToken, resolveCommit: okCommit("new-sha"), runScan, scheduleBackground: vi.fn() }
    );
    expect(result.outcome).toBe("queued");
    expect(result.commitSha).toBe("new-sha");
    expect(tables.scans.some((s) => s.status === "failed" && s.id === "scan-active")).toBe(true);
    expect(tables.scans.filter((s) => s.status === "queued").length).toBeGreaterThanOrEqual(1);
  });

  it("reuses an already-completed verdict instead of rescanning an unchanged commit", async () => {
    const verdict = buildVerdictFixture({ commitSha: "same-sha", status: "ready_to_ship", score: 95 });
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const admin = createFakeAdmin(tables);
    const runScan = vi.fn();
    const result = await triggerProductionReview(
      admin as never,
      { organizationId: ORG_A, projectId: PROJECT_1, githubRepo: "acme/alpha", githubRepositoryId: 42 },
      { resolveToken: okToken, resolveCommit: okCommit("same-sha"), runScan }
    );
    expect(result).toMatchObject({
      outcome: "already_completed",
      verdictStatus: "ready_to_ship",
      score: 95,
      reviewedCommitSha: "same-sha",
    });
    expect(runScan).not.toHaveBeenCalled();
    expect(tables.scans).toHaveLength(0);
  });

  it("starts a new review when a newer commit is requested even though a completed verdict exists for an older one", async () => {
    const verdict = buildVerdictFixture({ commitSha: "old-sha", status: "ready_to_ship", score: 95 });
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const admin = createFakeAdmin(tables);
    const runScan = vi.fn().mockResolvedValue(undefined);
    const result = await triggerProductionReview(
      admin as never,
      { organizationId: ORG_A, projectId: PROJECT_1, githubRepo: "acme/alpha", githubRepositoryId: 42 },
      { resolveToken: okToken, resolveCommit: okCommit("new-sha"), runScan, scheduleBackground: vi.fn() }
    );
    expect(result).toMatchObject({ outcome: "queued", commitSha: "new-sha" });
    expect(tables.scans).toHaveLength(1);
  });

  it("upserts repository_scan_state.active_scan_id to the newly created review", async () => {
    const tables = baseTables();
    const admin = createFakeAdmin(tables);
    const runScan = vi.fn().mockResolvedValue(undefined);
    const result = await triggerProductionReview(
      admin as never,
      { organizationId: ORG_A, projectId: PROJECT_1, githubRepo: "acme/alpha", githubRepositoryId: 42 },
      { resolveToken: okToken, resolveCommit: okCommit(), runScan, scheduleBackground: vi.fn() }
    );
    expect(result.outcome).toBe("queued");
    expect(tables.repository_scan_state).toHaveLength(1);
    expect(tables.repository_scan_state[0]).toMatchObject({
      repository_id: PROJECT_1,
      active_scan_id: (result as { reviewId: string }).reviewId,
    });
  });
});
