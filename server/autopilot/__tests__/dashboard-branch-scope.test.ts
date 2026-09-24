import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";

vi.mock("server-only", () => ({}));

let fake: ReturnType<typeof createFakeAdmin>;
vi.mock("@/server/security-scanner/admin-client", () => ({ createAdminClient: () => fake }));
vi.mock("../is-enabled", () => ({ isVerdictAutopilotEnabled: async () => true }));
vi.mock("@/server/production-verdict/service", () => ({
  getCurrentProductionVerdictsForProjects: async () => new Map(),
  getProductionVerdictScanIds: async () => new Set(),
}));

import { getAutopilotDashboardView } from "../get-dashboard-view";

const ORG = "org-a";
const P = "11111111-1111-4111-8111-111111111111";

function scan(id: string, branch: string, status: string, over: Record<string, unknown> = {}) {
  return { id, repository_id: P, status, branch, review_type: "automatic", created_at: "2026-02-01T00:00:00Z", completed_at: null, failed_at: null, ...over };
}

async function view(scans: unknown[]) {
  fake = createFakeAdmin({
    projects: [{ id: P, name: "Alpha", github_repo: "acme/alpha", github_repository_id: 1, webhook_enabled: true, organization_id: ORG, github_default_branch: "main", updated_at: "2026-01-01" }],
    github_webhooks: [{ project_id: P, active: true }],
    scans,
  } as never);
  const v = await getAutopilotDashboardView(fake as never, ORG);
  return (v as unknown as { projects: Array<{ state: string; lastAutomaticReviewAt: string | null }> }).projects[0];
}

describe("dashboard review state is the default branch's (PASS 5.6A-B)", () => {
  it("feature-only active: main is NOT shown as reviewing", async () => {
    expect((await view([scan("feat", "feature/x", "scanning")])).state).not.toBe("reviewing_changes");
  });
  it("main-only active: main is reviewing", async () => {
    expect((await view([scan("main-a", "main", "scanning")])).state).toBe("reviewing_changes");
  });
  it("both active: main is reviewing", async () => {
    expect((await view([scan("feat", "feature/x", "scanning"), scan("main-a", "main", "scanning")])).state).toBe("reviewing_changes");
  });
  it("neither active: not reviewing", async () => {
    expect((await view([scan("main-done", "main", "completed", { completed_at: "2026-02-01T00:10:00Z" })])).state).not.toBe("reviewing_changes");
  });
  it("a newer feature-branch automatic review is not the project's latest review", async () => {
    const p = await view([
      scan("feat-failed", "feature/x", "failed", { created_at: "2026-02-03T00:00:00Z", failed_at: "2026-02-03T00:01:00Z" }),
      scan("main-done", "main", "completed", { created_at: "2026-02-02T00:00:00Z", completed_at: "2026-02-02T00:01:00Z" }),
    ]);
    expect(p.lastAutomaticReviewAt).toBe("2026-02-02T00:01:00Z");
  });
});
