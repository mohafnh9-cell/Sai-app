import { describe, expect, it } from "vitest";
import { computeGithubSyncDisplay } from "@/lib/repository-sync/compute-sync-display";

describe("computeGithubSyncDisplay", () => {
  it("marks sync in progress when active review matches GitHub HEAD", () => {
    const view = computeGithubSyncDisplay({
      githubHeadSha: "b5f50bdabc",
      lastVerdictCommitSha: "ac8d0d0def",
      activeReviewCommitSha: "b5f50bdabc",
      hasActiveReview: true,
    });
    expect(view.syncInProgress).toBe(true);
    expect(view.repositoryOutOfSync).toBe(false);
  });

  it("marks out of sync when verdict lags and no active review on HEAD", () => {
    const view = computeGithubSyncDisplay({
      githubHeadSha: "b5f50bdabc",
      lastVerdictCommitSha: "ac8d0d0def",
      hasActiveReview: false,
    });
    expect(view.syncInProgress).toBe(false);
    expect(view.repositoryOutOfSync).toBe(true);
  });
});
