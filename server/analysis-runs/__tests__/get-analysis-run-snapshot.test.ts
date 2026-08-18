import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  AnalysisRunNotFoundError,
  getAnalysisRunSnapshot,
  isAnalysisRunOwnedByProject,
} from "../get-analysis-run-snapshot";

vi.mock("@/server/production-verdict/core", () => ({
  getProductionVerdictByScan: vi.fn(),
}));

import { getProductionVerdictByScan } from "@/server/production-verdict/core";

const RUN = "run-1";
const PROJECT = "proj-1";
const ORG = "org-1";

function buildAdmin(scan: Record<string, unknown> | null) {
  return {
    from: (table: string) => {
      if (table !== "scans") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () =>
                  scan ? { data: scan, error: null } : { data: null, error: null },
              }),
            }),
          }),
        }),
      };
    },
  } as never;
}

describe("isAnalysisRunOwnedByProject", () => {
  it("returns true when scan exists for project and org", async () => {
    const admin = buildAdmin({ id: RUN });
    await expect(
      isAnalysisRunOwnedByProject(admin, { projectId: PROJECT, organizationId: ORG, runId: RUN })
    ).resolves.toBe(true);
  });

  it("returns false when scan is missing", async () => {
    const admin = buildAdmin(null);
    await expect(
      isAnalysisRunOwnedByProject(admin, { projectId: PROJECT, organizationId: ORG, runId: RUN })
    ).resolves.toBe(false);
  });
});

describe("getAnalysisRunSnapshot", () => {
  beforeEach(() => {
    vi.mocked(getProductionVerdictByScan).mockReset();
  });

  it("returns snapshot with verdict", async () => {
    const verdict = { status: "ready_to_ship", score: 90 };
    vi.mocked(getProductionVerdictByScan).mockResolvedValue(verdict as never);

    const admin = buildAdmin({
      id: RUN,
      project_id: PROJECT,
      organization_id: ORG,
      status: "completed",
      commit_sha: "abc123",
      branch: "main",
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:05:00Z",
    });

    const snapshot = await getAnalysisRunSnapshot(admin, {
      organizationId: ORG,
      projectId: PROJECT,
      runId: RUN,
    });

    expect(snapshot).toMatchObject({
      runId: RUN,
      projectId: PROJECT,
      organizationId: ORG,
      status: "completed",
      commitSha: "abc123",
      branch: "main",
      verdict,
    });
    expect(getProductionVerdictByScan).toHaveBeenCalledWith(admin, ORG, RUN);
  });

  it("throws AnalysisRunNotFoundError when scan missing", async () => {
    const admin = buildAdmin(null);
    await expect(
      getAnalysisRunSnapshot(admin, { organizationId: ORG, projectId: PROJECT, runId: RUN })
    ).rejects.toBeInstanceOf(AnalysisRunNotFoundError);
  });
});
