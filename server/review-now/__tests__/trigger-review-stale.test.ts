import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { triggerProductionReview } from "../trigger-review";

const ORG_A = "org-a";
const PROJECT_1 = "11111111-1111-4111-8111-111111111111";

describe("triggerProductionReview stale recovery", () => {
  it("recovers a stale queued review before enqueueing a new one", async () => {
    const staleCreated = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const admin = createFakeAdmin({
      scans: [
        {
          id: "stale-review",
          repository_id: PROJECT_1,
          project_id: PROJECT_1,
          organization_id: ORG_A,
          status: "queued",
          created_at: staleCreated,
          updated_at: staleCreated,
        },
      ],
      repository_scan_state: [
        {
          repository_id: PROJECT_1,
          organization_id: ORG_A,
          active_scan_id: "stale-review",
        },
      ],
      production_verdicts: [],
      scan_job_events: [],
    });

    const runScan = vi.fn().mockResolvedValue(undefined);
    const result = await triggerProductionReview(
      admin as never,
      {
        organizationId: ORG_A,
        projectId: PROJECT_1,
        githubRepo: "https://github.com/acme/alpha",
        githubRepositoryId: 42,
      },
      {
        resolveToken: async () => ({ token: "gh-token", userId: "user-1" }),
        resolveCommit: async () => ({ sha: "new-sha", branch: "main" }),
        scheduleBackground: (fn) => {
          void fn();
        },
        runScan,
      }
    );

    expect(result.outcome).toBe("queued");
    expect(runScan).toHaveBeenCalledTimes(1);
    const { data: rows } = await admin.from("scans").select("*");
    const staleRow = rows?.find((row) => row.id === "stale-review");
    expect(staleRow?.status).toBe("failed");
    // The incoming commit ("new-sha") differs from the stale review's
    // target, so it's released via the commit-supersession path rather
    // than a pure timeout — that's a more specific, correct error code
    // than the generic timeout one this test originally asserted.
    expect(staleRow?.error_code).toBe("COMMIT_SUPERSEDED_BY_REMOTE_HEAD");
  });
});
