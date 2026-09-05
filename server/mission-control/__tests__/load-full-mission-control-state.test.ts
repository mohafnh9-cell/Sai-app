import { describe, expect, it, vi } from "vitest";

// Phase 12 audit regression test: loadFullMissionControlState's initial
// project lookup must never rely on RLS alone. `supabase` here can be an
// admin (service-role, RLS-bypassing) client -- always under
// SEQURAI_BYPASS_AUTH dev mode, and in some real callers too -- so the
// query itself must filter by organization_id. Live-confirmed during the
// Phase 12 audit: without this filter, requesting another organization's
// real projectId returned that project's full Mission Control state.
//
// Every downstream loader is mocked to throw if reached at all -- this
// proves the function returns null immediately after a cross-org project
// lookup, rather than merely asserting on the final output shape.

vi.mock("@/server/feature-flags", () => ({
  isFeatureEnabled: () => false,
}));
vi.mock("@/server/analysis-runs/list-analysis-runs", () => ({
  listAnalysisRunsForProject: vi.fn(async () => {
    throw new Error("must not be reached for a cross-org project");
  }),
}));
vi.mock("../load-mission-control-review-signals", () => ({
  loadMissionControlReviewSignals: vi.fn(async () => {
    throw new Error("must not be reached for a cross-org project");
  }),
}));
vi.mock("@/server/attack-simulation/get-security-test-context", () => ({
  getSecurityTestContext: vi.fn(async () => {
    throw new Error("must not be reached for a cross-org project");
  }),
}));
vi.mock("@/server/continuous-protection/protection-context", () => ({
  getProtectionCenterModel: vi.fn(async () => {
    throw new Error("must not be reached for a cross-org project");
  }),
}));
vi.mock("../load-mission-control-with-recovery", () => ({
  loadMissionControlWithRecovery: vi.fn(async () => {
    throw new Error("must not be reached for a cross-org project");
  }),
}));
vi.mock("../build-mission-control-state", () => ({
  buildMissionControlState: vi.fn(() => {
    throw new Error("must not be reached for a cross-org project");
  }),
}));
vi.mock("@/server/analysis-runs/load-run-findings-for-fix", () => ({
  loadAnalysisRunFindingsForFixPrompt: vi.fn(async () => {
    throw new Error("must not be reached for a cross-org project");
  }),
}));
vi.mock("@/server/security-scanner/finding-resolution", () => ({
  getScanFindingResolution: vi.fn(async () => {
    throw new Error("must not be reached for a cross-org project");
  }),
}));

const { loadFullMissionControlState } = await import("../load-full-mission-control-state");

/** A chainable query-builder stub that only resolves a row when every
 * expected .eq() filter (including organization_id) was actually applied. */
function projectsOnlyAdmin(row: { id: string; organization_id: string } | null) {
  return {
    from: (table: string) => {
      if (table !== "projects") {
        throw new Error(`unexpected table ${table} reached for a cross-org project`);
      }
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (col: string, value: unknown) => {
          filters[col] = value;
          return chain;
        },
        maybeSingle: async () => {
          const matches =
            row &&
            filters.id === row.id &&
            "organization_id" in filters &&
            filters.organization_id === row.organization_id;
          return { data: matches ? row : null, error: null };
        },
      };
      return chain;
    },
  } as never;
}

describe("loadFullMissionControlState (Phase 12 cross-tenant regression)", () => {
  it("returns null for a real project ID that belongs to a different organization", async () => {
    const otherOrgProject = { id: "project-in-org-b", organization_id: "org-b" };
    const admin = projectsOnlyAdmin(otherOrgProject);

    const result = await loadFullMissionControlState(admin, {
      projectId: otherOrgProject.id,
      organizationId: "org-a", // the caller's real org -- does not match
      admin,
      analysisRunId: null,
    });

    expect(result).toBeNull();
  });

  it("proceeds past the project lookup when the project genuinely belongs to the caller's organization", async () => {
    const ownProject = { id: "project-in-org-a", organization_id: "org-a" };
    const admin = projectsOnlyAdmin(ownProject);

    // Every downstream loader is mocked to throw -- reaching one of those
    // throws proves the org-matched lookup succeeded and execution moved
    // on, which is the behavior we want (as opposed to null).
    await expect(
      loadFullMissionControlState(admin, {
        projectId: ownProject.id,
        organizationId: "org-a",
        admin,
        analysisRunId: null,
      })
    ).rejects.toThrow("must not be reached for a cross-org project");
  });
});
