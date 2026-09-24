import { describe, expect, it, vi, beforeEach } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { resolveAnalysisRunForMissionControl } from "../resolve-analysis-run";

vi.mock("@/server/review-cancel/get-production-review-state", () => ({
  getProductionReviewState: vi.fn(),
}));

vi.mock("../get-analysis-run-snapshot", () => ({
  isAnalysisRunOwnedByProject: vi.fn(),
}));

import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { isAnalysisRunOwnedByProject } from "../get-analysis-run-snapshot";

const PROJECT = "proj-1";
const ORG = "org-1";
const RUN = "run-abc";

function scanRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    project_id: PROJECT,
    repository_id: PROJECT,
    organization_id: ORG,
    status: "completed",
    branch: "main",
    completed_at: "2026-02-01T00:00:00Z",
    created_at: "2026-02-01T00:00:00Z",
    ...over,
  };
}

function buildAdmin(scans: Array<Record<string, unknown>>) {
  return createFakeAdmin({
    projects: [{ id: PROJECT, organization_id: ORG, github_default_branch: "main" }],
    scans,
  } as never) as never;
}

describe("resolveAnalysisRunForMissionControl", () => {
  beforeEach(() => {
    vi.mocked(getProductionReviewState).mockReset();
    vi.mocked(isAnalysisRunOwnedByProject).mockReset();
  });

  it("returns requested run when owned", async () => {
    vi.mocked(isAnalysisRunOwnedByProject).mockResolvedValue(true);

    const result = await resolveAnalysisRunForMissionControl({} as never, {
      projectId: PROJECT,
      organizationId: ORG,
      requestedRunId: RUN,
    });

    expect(result).toEqual({ runId: RUN, source: "query", valid: true });
  });

  it("marks invalid when requested run is not owned", async () => {
    vi.mocked(isAnalysisRunOwnedByProject).mockResolvedValue(false);

    const result = await resolveAnalysisRunForMissionControl({} as never, {
      projectId: PROJECT,
      organizationId: ORG,
      requestedRunId: RUN,
    });

    expect(result).toEqual({ runId: null, source: "none", valid: false });
  });

  it("prefers active review scan when no query param", async () => {
    vi.mocked(getProductionReviewState).mockResolvedValue({
      scanId: "active-scan",
      hasActiveReview: true,
      status: "running",
    } as never);

    const result = await resolveAnalysisRunForMissionControl({} as never, {
      projectId: PROJECT,
      organizationId: ORG,
    });

    expect(result).toEqual({ runId: "active-scan", source: "active", valid: true });
  });

  it("falls back to latest completed scan", async () => {
    vi.mocked(getProductionReviewState).mockResolvedValue({
      scanId: null,
      hasActiveReview: false,
      status: "idle",
    } as never);

    const admin = buildAdmin([scanRow("completed-scan")]);

    const result = await resolveAnalysisRunForMissionControl(admin, {
      projectId: PROJECT,
      organizationId: ORG,
    });

    expect(result).toEqual({ runId: "completed-scan", source: "latest_completed", valid: true });
  });

  it("falls back to latest active scan when no completed", async () => {
    vi.mocked(getProductionReviewState).mockResolvedValue({
      scanId: null,
      hasActiveReview: false,
      status: "idle",
    } as never);

    const admin = buildAdmin([scanRow("queued-scan", { status: "queued", completed_at: null })]);

    const result = await resolveAnalysisRunForMissionControl(admin, {
      projectId: PROJECT,
      organizationId: ORG,
    });

    expect(result).toEqual({ runId: "queued-scan", source: "active", valid: true });
  });

  it("returns none when no scans exist", async () => {
    vi.mocked(getProductionReviewState).mockResolvedValue({
      scanId: null,
      hasActiveReview: false,
      status: "idle",
    } as never);

    const admin = buildAdmin([]);

    const result = await resolveAnalysisRunForMissionControl(admin, {
      projectId: PROJECT,
      organizationId: ORG,
    });

    expect(result).toEqual({ runId: null, source: "none", valid: true });
  });

  describe("branch scope (PASS 5.6A-B)", () => {
    const idle = { scanId: null, hasActiveReview: false, status: "idle" } as never;

    it("main completed + feature completed (feature newer): resolving the default returns main", async () => {
      vi.mocked(getProductionReviewState).mockResolvedValue(idle);
      const admin = buildAdmin([
        scanRow("feat-done", { branch: "feature/x", completed_at: "2026-02-03T00:00:00Z" }),
        scanRow("main-done", { branch: "main", completed_at: "2026-02-02T00:00:00Z" }),
      ]);
      const r = await resolveAnalysisRunForMissionControl(admin, { projectId: PROJECT, organizationId: ORG });
      expect(r.runId).toBe("main-done");
    });

    it("resolving an explicit feature branch returns the feature run", async () => {
      vi.mocked(getProductionReviewState).mockResolvedValue(idle);
      const admin = buildAdmin([
        scanRow("feat-done", { branch: "feature/x", completed_at: "2026-02-03T00:00:00Z" }),
        scanRow("main-done", { branch: "main", completed_at: "2026-02-04T00:00:00Z" }),
      ]);
      const r = await resolveAnalysisRunForMissionControl(admin, { projectId: PROJECT, organizationId: ORG, branch: "feature/x" });
      expect(r.runId).toBe("feat-done");
    });

    it("feature completed only: the default branch has no run (a feature run is never presented as main's)", async () => {
      vi.mocked(getProductionReviewState).mockResolvedValue(idle);
      const admin = buildAdmin([scanRow("feat-done", { branch: "feature/x" })]);
      const r = await resolveAnalysisRunForMissionControl(admin, { projectId: PROJECT, organizationId: ORG });
      expect(r).toEqual({ runId: null, source: "none", valid: true });
    });

    it("main active + feature active: default resolution returns main's active run", async () => {
      vi.mocked(getProductionReviewState).mockResolvedValue(idle);
      const admin = buildAdmin([
        scanRow("feat-active", { branch: "feature/x", status: "scanning", completed_at: null, created_at: "2026-02-05T00:00:00Z" }),
        scanRow("main-active", { branch: "main", status: "scanning", completed_at: null, created_at: "2026-02-04T00:00:00Z" }),
      ]);
      const r = await resolveAnalysisRunForMissionControl(admin, { projectId: PROJECT, organizationId: ORG });
      expect(r).toEqual({ runId: "main-active", source: "active", valid: true });
    });

    it("feature active + main active: explicit feature resolution returns the feature's active run", async () => {
      vi.mocked(getProductionReviewState).mockResolvedValue(idle);
      const admin = buildAdmin([
        scanRow("feat-active", { branch: "feature/x", status: "scanning", completed_at: null, created_at: "2026-02-04T00:00:00Z" }),
        scanRow("main-active", { branch: "main", status: "scanning", completed_at: null, created_at: "2026-02-05T00:00:00Z" }),
      ]);
      const r = await resolveAnalysisRunForMissionControl(admin, { projectId: PROJECT, organizationId: ORG, branch: "feature/x" });
      expect(r).toEqual({ runId: "feat-active", source: "active", valid: true });
    });
  });
});

