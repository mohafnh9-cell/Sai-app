import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { cancelReview } from "@/server/mcp/tools/cancel-review";
import { createFakeAdmin } from "./fake-admin";
import { testMcpAuthContext } from "./test-context";

vi.mock("@/server/review-cancel/cancel-production-review", () => ({
  CancelProductionReviewError: class extends Error {},
  cancelProductionReview: vi.fn(),
}));
import { cancelProductionReview } from "@/server/review-cancel/cancel-production-review";

const ORG = "org-a";
const P = "11111111-1111-4111-8111-111111111111";
const t = getMcpTranslator("en");
const NOW = () => new Date().toISOString();
const scan = (id: string, branch: string, over: Record<string, unknown> = {}) => ({
  id, repository_id: P, organization_id: ORG, project_id: P, status: "scanning", branch, commit_sha: id, created_at: NOW(), ...over,
});

function ctx(scans: unknown[]) {
  const admin = createFakeAdmin({
    projects: [{ id: P, name: "Alpha", github_repo: "acme/alpha", organization_id: ORG, created_at: "2026-01-01", github_default_branch: "main" }],
    scans,
  } as never);
  return testMcpAuthContext(admin, { organizationId: ORG });
}

describe("cancel_review is branch-scoped (PASS 5.6A-B)", () => {
  beforeEach(() => {
    vi.mocked(cancelProductionReview).mockReset();
    vi.mocked(cancelProductionReview).mockImplementation((async (_admin: unknown, input: { reviewId: string }) => ({
      cancelled: true,
      reviewId: input.reviewId,
    })) as never);
  });

  it("main + feature active: no id cancels the DEFAULT branch's review only (feature keeps running)", async () => {
    const r = await cancelReview(ctx([scan("feat", "feature/x", { created_at: "2026-03-02T00:00:00Z" }), scan("main-a", "main", { created_at: "2026-03-01T00:00:00Z" })]), {}, t);
    expect(r.reviewId).toBe("main-a");
    expect(vi.mocked(cancelProductionReview).mock.calls.map((c) => c[1].reviewId)).toEqual(["main-a"]);
  });

  it("an explicit branch cancels that branch's review only (main keeps running)", async () => {
    const r = await cancelReview(ctx([scan("feat", "feature/x"), scan("main-a", "main")]), { branch: "feature/x" }, t);
    expect(r.reviewId).toBe("feat");
    expect(vi.mocked(cancelProductionReview).mock.calls.map((c) => c[1].reviewId)).toEqual(["feat"]);
  });

  it("only a feature review is active and no branch/id is given: fails closed (nothing is cancelled)", async () => {
    const r = await cancelReview(ctx([scan("feat", "feature/x")]), {}, t);
    expect(r.cancelled).toBe(false);
    expect(r.reviewId).toBeNull();
    expect(cancelProductionReview).not.toHaveBeenCalled();
  });

  it("an explicit review id is used as given", async () => {
    const r = await cancelReview(ctx([scan("feat", "feature/x"), scan("main-a", "main")]), { reviewId: "feat" }, t);
    expect(r.reviewId).toBe("feat");
    expect(vi.mocked(cancelProductionReview).mock.calls.map((c) => c[1].reviewId)).toEqual(["feat"]);
  });

  it("an explicit branch with no active review there cancels nothing (never falls back to another branch)", async () => {
    const r = await cancelReview(ctx([scan("main-a", "main")]), { branch: "feature/x" }, t);
    expect(r.cancelled).toBe(false);
    expect(cancelProductionReview).not.toHaveBeenCalled();
  });
});
