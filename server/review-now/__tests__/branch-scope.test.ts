import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { getLatestReviewSummary } from "@/server/mcp/latest-review";
import { triggerProductionReview } from "../trigger-review";

const ORG = "org-a";
const P = "11111111-1111-4111-8111-111111111111";

function tables(over: Record<string, unknown[]> = {}) {
  return {
    projects: [{ id: P, organization_id: ORG, github_default_branch: "main", github_last_commit_sha: "main-head" }],
    scans: [],
    repository_scan_state: [],
    repository_sync_status: [{ project_id: P, commit_sha: "main-head", branch: "main" }],
    production_verdicts: [],
    scan_job_events: [],
    ...over,
  } as never;
}

async function run(admin: ReturnType<typeof createFakeAdmin>, resolved: { sha: string; branch: string }, extra: Record<string, unknown> = {}) {
  return triggerProductionReview(
    admin as never,
    { organizationId: ORG, projectId: P, githubRepo: "https://github.com/acme/alpha", githubRepositoryId: 42, ...extra },
    {
      resolveToken: async () => ({ token: "t", userId: "u" }),
      resolveCommit: async () => resolved,
      scheduleBackground: (fn) => void fn(),
      runScan: vi.fn().mockResolvedValue(undefined),
    }
  );
}

describe("PASS 5.4 branch scoping of decision state", () => {
  it("latest review ignores scans of a non-default branch", async () => {
    const admin = createFakeAdmin(
      tables({
        scans: [
          { id: "feature", repository_id: P, status: "completed", commit_sha: "f1", branch: "feature/x", created_at: "2026-02-02T00:00:00Z" },
          { id: "main-scan", repository_id: P, status: "completed", commit_sha: "main-head", branch: "main", created_at: "2026-02-01T00:00:00Z" },
        ],
      })
    );
    expect((await getLatestReviewSummary(admin as never, P))?.id).toBe("main-scan");
  });

  it("latest review still works when the default branch is unknown", async () => {
    const admin = createFakeAdmin(
      tables({
        projects: [{ id: P, organization_id: ORG }],
        scans: [{ id: "s1", repository_id: P, status: "completed", commit_sha: "a", branch: "x", created_at: "2026-02-02T00:00:00Z" }],
      })
    );
    expect((await getLatestReviewSummary(admin as never, P))?.id).toBe("s1");
  });

  it("a feature-branch review does not overwrite the detected default-branch head", async () => {
    const admin = createFakeAdmin(tables());
    await run(admin, { sha: "feature-sha", branch: "feature/x" }, { requestedBranch: "feature/x" });
    const { data } = await admin.from("repository_sync_status").select("*");
    expect(data?.[0]?.commit_sha).toBe("main-head");
    const { data: proj } = await admin.from("projects").select("*");
    expect(proj?.[0]?.github_last_commit_sha).toBe("main-head");
  });

  it("an explicit older commit does not become the detected head", async () => {
    const admin = createFakeAdmin(tables());
    await run(admin, { sha: "older-sha", branch: "main" }, { requestedCommitSha: "older-sha" });
    const { data } = await admin.from("repository_sync_status").select("*");
    expect(data?.[0]?.commit_sha).toBe("main-head");
  });

  it("a default-branch head review still records the live head", async () => {
    const admin = createFakeAdmin(tables());
    await run(admin, { sha: "new-main-head", branch: "main" });
    const { data } = await admin.from("repository_sync_status").select("*");
    expect(data?.[0]?.commit_sha).toBe("new-main-head");
  });
});

import { getStalenessInfo } from "@/server/mcp/staleness";
import { recordLiveHeadCommit } from "@/server/repository-sync/persistence";
import { refreshGitHubHeadForProject } from "@/server/repository-sync/refresh-github-head";

describe("PASS 5.5 secondary branch-scope leaks", () => {
  it("recordLiveHeadCommit ignores non-default branches (central guard)", async () => {
    const admin = createFakeAdmin(tables());
    await recordLiveHeadCommit(admin as never, { organizationId: ORG, projectId: P, githubRepositoryId: 1, commitSha: "f", branch: "feature/x" });
    const { data } = await admin.from("repository_sync_status").select("*");
    expect(data?.[0]?.commit_sha).toBe("main-head");
    await recordLiveHeadCommit(admin as never, { organizationId: ORG, projectId: P, githubRepositoryId: 1, commitSha: "m2", branch: "main" });
    expect((await admin.from("repository_sync_status").select("*")).data?.[0]?.commit_sha).toBe("m2");
  });

  it("head refresh of a feature branch does not touch project last commit / detected head", async () => {
    const admin = createFakeAdmin(tables());
    await refreshGitHubHeadForProject(admin as never, {
      organizationId: ORG,
      projectId: P,
      githubRepo: "https://github.com/acme/alpha",
      branch: "feature/x",
      githubService: { resolveCommitReference: async () => ({ sha: "feat-sha", branch: "feature/x" }) } as never,
    });
    expect((await admin.from("projects").select("*")).data?.[0]?.github_last_commit_sha).toBe("main-head");
    expect((await admin.from("repository_sync_status").select("*")).data?.[0]?.commit_sha).toBe("main-head");
  });

  it("an active review of another branch is not 'review in progress' for the default branch", async () => {
    const admin = createFakeAdmin(
      tables({
        scans: [{ id: "feat-active", repository_id: P, status: "running", branch: "feature/x", commit_sha: "f", created_at: "2026-02-02T00:00:00Z", review_type: "manual" }],
        repository_scan_state: [{ repository_id: P, organization_id: ORG, active_scan_id: "feat-active" }],
      })
    );
    expect((await getStalenessInfo(admin as never, P, "main-head")).reviewInProgress).toBe(false);
  });

  it("an active default-branch review still counts as in progress", async () => {
    const admin = createFakeAdmin(
      tables({
        scans: [{ id: "main-active", repository_id: P, status: "running", branch: "main", commit_sha: "m", created_at: "2026-02-02T00:00:00Z", review_type: "manual" }],
        repository_scan_state: [{ repository_id: P, organization_id: ORG, active_scan_id: "main-active" }],
      })
    );
    expect((await getStalenessInfo(admin as never, P, "main-head")).reviewInProgress).toBe(true);
  });

  it("a failed automatic review of a feature branch is not evidence that the default branch is stale", async () => {
    const admin = createFakeAdmin(
      tables({
        repository_sync_status: [],
        scans: [{ id: "feat-auto", repository_id: P, status: "failed", branch: "feature/x", commit_sha: "f", created_at: "2026-02-02T00:00:00Z", review_type: "automatic" }],
      })
    );
    const info = await getStalenessInfo(admin as never, P, "main-head");
    expect(info.reviewFailed).toBe(false);
    expect(info.latestDetectedCommitSha).toBeNull();
  });
});

import { loadVerdictJourneyRecords } from "@/server/production-journey/load-verdicts";
import { getLatestVerdictsByOrganization } from "@/server/production-verdict/core";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";

describe("PASS 5.5 history / org-latest are default-branch scoped", () => {
  const mainV = buildVerdictFixture({ status: "ready_to_ship", branch: "main", scanId: "22222222-2222-4222-8222-222222222221" });
  const featV = buildVerdictFixture({ status: "not_ready", branch: "feature/x", scanId: "22222222-2222-4222-8222-222222222222" });
  const rows = () => [
    { ...verdictRow(P, mainV), generated_at: "2026-02-01T00:00:00.000Z" },
    { ...verdictRow(P, featV), generated_at: "2026-02-02T00:00:00.000Z" },
  ];

  it("journey/history records exclude feature-branch verdicts", async () => {
    const admin = createFakeAdmin(tables({ production_verdicts: rows() }));
    const { records } = await loadVerdictJourneyRecords(admin as never, P);
    expect(records.map((r) => r.branch)).toEqual(["main"]);
  });

  it("org-wide latest verdict per project is the default branch's", async () => {
    const admin = createFakeAdmin(tables({ production_verdicts: rows() }));
    const map = await getLatestVerdictsByOrganization(admin as never, ORG);
    expect(map.get(P)?.branch).toBe("main");
  });
});
