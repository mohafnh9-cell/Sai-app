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
