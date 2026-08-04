import { describe, expect, it, vi } from "vitest";
import {
  AnalysisRunImmutableError,
  assertAnalysisRunMutable,
} from "../assert-analysis-run-mutable";

function mockAdmin(row: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq3 = vi.fn().mockReturnValue({ maybeSingle });
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  return { from } as never;
}

describe("assertAnalysisRunMutable", () => {
  it("allows active runs", async () => {
    const admin = mockAdmin({ id: "run-1", status: "scanning", immutability_locked_at: null });
    await expect(
      assertAnalysisRunMutable(admin, {
        runId: "run-1",
        projectId: "proj-1",
        organizationId: "org-1",
      })
    ).resolves.toBeUndefined();
  });

  it("throws when immutability_locked_at is set", async () => {
    const admin = mockAdmin({
      id: "run-1",
      status: "completed",
      immutability_locked_at: "2026-01-01T00:00:00.000Z",
    });
    await expect(
      assertAnalysisRunMutable(admin, {
        runId: "run-1",
        projectId: "proj-1",
        organizationId: "org-1",
      })
    ).rejects.toBeInstanceOf(AnalysisRunImmutableError);
  });

  it("throws for terminal status without lock timestamp", async () => {
    const admin = mockAdmin({ id: "run-1", status: "failed", immutability_locked_at: null });
    await expect(
      assertAnalysisRunMutable(admin, {
        runId: "run-1",
        projectId: "proj-1",
        organizationId: "org-1",
      })
    ).rejects.toBeInstanceOf(AnalysisRunImmutableError);
  });
});
