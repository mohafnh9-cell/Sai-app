import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveReviewIdempotency } from "../idempotency";

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
}) {
  return {
    from: (table: string) => {
      if (table !== "scans") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_col: string, _val: string) => ({
            in: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: input.active ?? [], error: null }),
              }),
            }),
            eq: (_col2: string, _val2: string) => ({
              eq: (_col3: string, _val3: string) => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: input.completed ?? [], error: null }),
                }),
              }),
            }),
          }),
        }),
      };
    },
  } as never;
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

  it("still resumes active scan when forceNew is true", async () => {
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

    expect(result).toEqual({
      action: "resume_active",
      scan: expect.objectContaining({ id: "scan-active" }),
    });
  });

  it("returns create_new when no matching scans exist", async () => {
    const admin = buildAdmin({});

    const result = await resolveReviewIdempotency(admin, {
      projectId: PROJECT,
      commitSha: COMMIT,
    });

    expect(result).toEqual({ action: "create_new" });
  });
});
