import { describe, expect, it } from "vitest";
import { COMMIT_SUPERSEDED_CODE } from "@/server/review-start/release-active-review-for-new-head";

describe("releaseActiveReviewForNewHead constants", () => {
  it("uses a stable superseded error code", () => {
    expect(COMMIT_SUPERSEDED_CODE).toBe("COMMIT_SUPERSEDED_BY_REMOTE_HEAD");
  });
});

import { vi } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { releaseActiveReviewForNewHead } from "@/server/review-start/release-active-review-for-new-head";

vi.mock("server-only", () => ({}));

describe("releaseActiveReviewForNewHead branch scope (PASS 5.6)", () => {
  const P = "11111111-1111-4111-8111-111111111111";
  const tables = () =>
    ({
      scans: [
        { id: "feat", repository_id: P, status: "scanning", commit_sha: "f1", branch: "feature/x", created_at: "2026-02-01T00:00:00Z" },
        { id: "old-main", repository_id: P, status: "scanning", commit_sha: "m0", branch: "main", created_at: "2026-02-01T00:00:00Z" },
      ],
      scan_jobs: [],
      repository_scan_state: [],
    }) as never;

  it("a new main head releases older main reviews but never a feature-branch review", async () => {
    const admin = createFakeAdmin(tables());
    const result = await releaseActiveReviewForNewHead(admin as never, {
      organizationId: "org",
      projectId: P,
      targetCommitSha: "m1",
      targetBranch: "main",
    });
    expect(result.releasedScanIds).toEqual(["old-main"]);
    const { data } = await admin.from("scans").select("*");
    expect(data?.find((s) => s.id === "feat")?.status).toBe("scanning");
  });
});
