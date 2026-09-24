import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { triggerProductionReview } from "../trigger-review";
import { getStalenessInfo } from "@/server/mcp/staleness";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { hasActiveRepositoryReview } from "@/server/automatic-review/queries";

const ORG = "org-a";
const P = "11111111-1111-4111-8111-111111111111";
const NOW = () => new Date().toISOString();

const scan = (id: string, branch: string, commit: string, over: Record<string, unknown> = {}) => ({
  id,
  repository_id: P,
  organization_id: ORG,
  status: "scanning",
  branch,
  commit_sha: commit,
  scan_type: "full",
  created_at: NOW(),
  updated_at: NOW(),
  started_at: NOW(),
  ...over,
});

function tables(scans: unknown[], stateActive: string | null = null) {
  return {
    projects: [{ id: P, organization_id: ORG, github_default_branch: "main", github_last_commit_sha: "m0" }],
    scans,
    scan_jobs: [],
    repository_scan_state: [{ repository_id: P, organization_id: ORG, active_scan_id: stateActive }],
    repository_sync_status: [{ project_id: P, commit_sha: "m0", branch: "main" }],
    production_verdicts: [],
    scan_job_events: [],
  } as never;
}

async function review(admin: ReturnType<typeof createFakeAdmin>, resolved: { sha: string; branch: string }, extra: Record<string, unknown> = {}) {
  const runScan = vi.fn().mockResolvedValue(undefined);
  const result = await triggerProductionReview(
    admin as never,
    { organizationId: ORG, projectId: P, githubRepo: "https://github.com/acme/alpha", githubRepositoryId: 42, ...extra },
    {
      resolveToken: async () => ({ token: "t", userId: "u" }),
      resolveCommit: async () => resolved,
      scheduleBackground: vi.fn(),
      runScan,
    }
  );
  return result;
}

const statusOf = async (admin: ReturnType<typeof createFakeAdmin>, id: string) =>
  (await admin.from("scans").select("*")).data?.find((s) => s.id === id);
const state = async (admin: ReturnType<typeof createFakeAdmin>) =>
  (await admin.from("repository_scan_state").select("*")).data?.[0];

describe("PASS 5.6A branch-scoped review lifecycle", () => {
  it("A: feature ACTIVE -> main review_now starts its own review; feature is untouched", async () => {
    const admin = createFakeAdmin(tables([scan("feat", "feature/x", "f1")]));
    const r = await review(admin, { sha: "m1", branch: "main" });
    expect(r.outcome).toBe("queued");
    expect((await statusOf(admin, "feat"))?.status).toBe("scanning");
    const created = (await admin.from("scans").select("*")).data?.find((s) => s.id !== "feat");
    expect(created).toMatchObject({ branch: "main", commit_sha: "m1" });
    expect((await state(admin))?.active_scan_id).toBe(created?.id);
  });

  it("B: main ACTIVE -> feature review starts; main untouched and stays the tracked active review", async () => {
    const admin = createFakeAdmin(tables([scan("main-a", "main", "m1")], "main-a"));
    const r = await review(admin, { sha: "f1", branch: "feature/x" }, { requestedBranch: "feature/x" });
    expect(r.outcome).toBe("queued");
    expect((await statusOf(admin, "main-a"))?.status).toBe("scanning");
    expect((await state(admin))?.active_scan_id).toBe("main-a");
  });

  it("C/T: main ACTIVE -> another main review of the same commit deduplicates", async () => {
    const admin = createFakeAdmin(tables([scan("main-a", "main", "m1")], "main-a"));
    const r = await review(admin, { sha: "m1", branch: "main" });
    expect(r).toEqual({ outcome: "processing", reviewId: "main-a" });
  });

  it("D: feature ACTIVE -> another review of the same feature branch deduplicates", async () => {
    const admin = createFakeAdmin(tables([scan("feat", "feature/x", "f1")]));
    const r = await review(admin, { sha: "f1", branch: "feature/x" }, { requestedBranch: "feature/x" });
    expect(r).toEqual({ outcome: "processing", reviewId: "feat" });
  });

  it("E/U: same branch, newer head supersedes the older active review", async () => {
    const admin = createFakeAdmin(tables([scan("main-old", "main", "m0-old")], "main-old"));
    const r = await review(admin, { sha: "m2", branch: "main" });
    expect(r.outcome).toBe("queued");
    expect((await statusOf(admin, "main-old"))).toMatchObject({ status: "failed", error_code: "COMMIT_SUPERSEDED_BY_REMOTE_HEAD" });
  });

  it("F: main ACTIVE -> newer feature head does not supersede main", async () => {
    const admin = createFakeAdmin(tables([scan("main-a", "main", "m1")], "main-a"));
    await review(admin, { sha: "f9", branch: "feature/x" }, { requestedBranch: "feature/x" });
    expect((await statusOf(admin, "main-a"))?.status).toBe("scanning");
  });

  it("G: feature ACTIVE -> newer main head does not supersede the feature review", async () => {
    const admin = createFakeAdmin(tables([scan("feat", "feature/x", "f1")]));
    await review(admin, { sha: "m9", branch: "main" });
    expect((await statusOf(admin, "feat"))?.status).toBe("scanning");
  });

  it("V: different branch + different commit -> independent lifecycles (no dedup, no supersession)", async () => {
    const admin = createFakeAdmin(tables([scan("feat", "feature/x", "f1"), scan("other", "feature/y", "y1")]));
    const r = await review(admin, { sha: "m3", branch: "main" });
    expect(r.outcome).toBe("queued");
    expect((await statusOf(admin, "feat"))?.status).toBe("scanning");
    expect((await statusOf(admin, "other"))?.status).toBe("scanning");
  });

  it("an explicit older commit supersedes nothing", async () => {
    const admin = createFakeAdmin(tables([scan("main-a", "main", "m5")], "main-a"));
    await review(admin, { sha: "m1", branch: "main" }, { requestedCommitSha: "m1" });
    expect((await statusOf(admin, "main-a"))?.status).toBe("scanning");
  });

  it("P: feature ACTIVE -> default-branch reviewInProgress stays false; main ACTIVE -> true", async () => {
    const featOnly = createFakeAdmin(tables([scan("feat", "feature/x", "f1")], "feat"));
    expect((await getStalenessInfo(featOnly as never, P, "m0")).reviewInProgress).toBe(false);
    const mainActive = createFakeAdmin(tables([scan("main-a", "main", "m1")], "main-a"));
    expect((await getStalenessInfo(mainActive as never, P, "m0")).reviewInProgress).toBe(true);
  });

  it("default-scope active-review lookups ignore feature reviews (UI / push paths)", async () => {
    const admin = createFakeAdmin(tables([scan("feat", "feature/x", "f1")]));
    expect(await hasActiveRepositoryReview(admin as never, P)).toBe(false);
    expect(await hasActiveRepositoryReview(admin as never, P, "feature/x")).toBe(true);
  });

  it("production review state is the default branch's: a feature job neither shows nor hides main's", async () => {
    const jobs = [
      { id: "job-feat", scan_id: "feat", organization_id: ORG, project_id: P, status: "running", created_at: "2026-02-02T00:00:00Z" },
      { id: "job-main", scan_id: "main-a", organization_id: ORG, project_id: P, status: "running", created_at: "2026-02-01T00:00:00Z" },
    ];
    const base = tables([scan("feat", "feature/x", "f1"), scan("main-a", "main", "m1")], "main-a") as Record<string, unknown>;
    const both = createFakeAdmin({ ...base, scan_jobs: jobs } as never);
    const s1 = await getProductionReviewState(both as never, { organizationId: ORG, projectId: P, recoverStale: false });
    expect(s1.scanId).toBe("main-a");
    const featOnly = createFakeAdmin({ ...base, scan_jobs: [jobs[0]], repository_scan_state: [{ repository_id: P, organization_id: ORG, active_scan_id: null }] } as never);
    const s2 = await getProductionReviewState(featOnly as never, { organizationId: ORG, projectId: P, recoverStale: false });
    expect(s2.hasActiveReview).toBe(false);
  });
});
