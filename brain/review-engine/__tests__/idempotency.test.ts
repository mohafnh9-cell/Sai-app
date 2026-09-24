import { describe, expect, it, vi, beforeEach } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { resolveReviewIdempotency } from "../idempotency";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/repository-sync/commits-match", () => ({
  commitsMatch: (a: string, b: string) => a.toLowerCase() === b.toLowerCase(),
}));

vi.mock("@/brain/automatic-review/review-status", () => ({
  isActiveReviewScanStatus: (status: string) =>
    ["queued", "scanning", "fetching_repository"].includes(status),
}));

const PROJECT = "11111111-1111-4111-8111-111111111111";
const COMMIT = "abc123def456";

function buildAdmin(input: {
  active?: Array<Record<string, unknown>>;
  completed?: Array<Record<string, unknown>>;
  defaultBranch?: string | null;
}) {
  const withProject = (row: Record<string, unknown>) => ({
    repository_id: PROJECT,
    branch: "main",
    created_at: "2026-02-01T00:00:00Z",
    completed_at: "2026-02-01T00:00:00Z",
    ...row,
  });
  return createFakeAdmin({
    projects: [{ id: PROJECT, github_default_branch: input.defaultBranch === undefined ? "main" : input.defaultBranch }],
    scans: [...(input.active ?? []), ...(input.completed ?? [])].map(withProject),
  } as never) as never;
}

describe("resolveReviewIdempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses completed scan for same commit by default", async () => {
    const admin = buildAdmin({
      completed: [
        {
          id: "scan-done",
          status: "completed",
          commit_sha: COMMIT,
          review_type: "manual",
        },
      ],
    });

    const result = await resolveReviewIdempotency(admin, {
      projectId: PROJECT,
      commitSha: COMMIT,
    });

    expect(result).toEqual({
      action: "reuse_completed",
      scan: expect.objectContaining({ id: "scan-done" }),
    });
  });

  it("skips reuse when forceNew is true", async () => {
    const admin = buildAdmin({
      completed: [
        {
          id: "scan-done",
          status: "completed",
          commit_sha: COMMIT,
          review_type: "manual",
        },
      ],
    });

    const result = await resolveReviewIdempotency(admin, {
      projectId: PROJECT,
      commitSha: COMMIT,
      forceNew: true,
    });

    expect(result).toEqual({ action: "create_new" });
  });

  it("skips resume when forceNew is true", async () => {
    const admin = buildAdmin({
      active: [
        {
          id: "scan-active",
          status: "queued",
          commit_sha: COMMIT,
          review_type: "manual",
        },
      ],
    });

    const result = await resolveReviewIdempotency(admin, {
      projectId: PROJECT,
      commitSha: COMMIT,
      forceNew: true,
    });

    expect(result).toEqual({ action: "create_new" });
  });

  it("returns create_new when no matching scans exist", async () => {
    const admin = buildAdmin({});

    const result = await resolveReviewIdempotency(admin, {
      projectId: PROJECT,
      commitSha: COMMIT,
    });

    expect(result).toEqual({ action: "create_new" });
  });

  describe("branch scope (PASS 5.6A-B)", () => {
    const active = (id: string, branch: string) => ({ id, status: "queued", commit_sha: COMMIT, review_type: "manual", branch });
    const done = (id: string, branch: string) => ({ id, status: "completed", commit_sha: COMMIT, review_type: "manual", branch });

    it("same branch + same commit + same type resumes the active review", async () => {
      const admin = buildAdmin({ active: [active("main-active", "main")] });
      const r = await resolveReviewIdempotency(admin, { projectId: PROJECT, commitSha: COMMIT, branch: "main" });
      expect(r).toEqual({ action: "resume_active", scan: expect.objectContaining({ id: "main-active" }) });
    });

    it("same commit on a different branch never resumes the other branch's active review", async () => {
      const admin = buildAdmin({ active: [active("main-active", "main")] });
      const r = await resolveReviewIdempotency(admin, { projectId: PROJECT, commitSha: COMMIT, branch: "feature/x" });
      expect(r).toEqual({ action: "create_new" });
    });

    it("main + feature active at the same commit: each resolves to its own", async () => {
      const admin = buildAdmin({ active: [active("main-active", "main"), active("feat-active", "feature/x")] });
      expect((await resolveReviewIdempotency(admin, { projectId: PROJECT, commitSha: COMMIT, branch: "feature/x" }))).toEqual({
        action: "resume_active",
        scan: expect.objectContaining({ id: "feat-active" }),
      });
      expect((await resolveReviewIdempotency(admin, { projectId: PROJECT, commitSha: COMMIT }))).toEqual({
        action: "resume_active",
        scan: expect.objectContaining({ id: "main-active" }),
      });
    });

    it("a completed review of another branch is not reused", async () => {
      const admin = buildAdmin({ completed: [done("feat-done", "feature/x")] });
      expect(await resolveReviewIdempotency(admin, { projectId: PROJECT, commitSha: COMMIT, branch: "main" })).toEqual({ action: "create_new" });
      expect((await resolveReviewIdempotency(admin, { projectId: PROJECT, commitSha: COMMIT, branch: "feature/x" })).action).toBe("reuse_completed");
    });
  });
});

