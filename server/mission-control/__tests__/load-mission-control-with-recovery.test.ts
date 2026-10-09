import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadMissionControlWithRecovery } from "../load-mission-control-with-recovery";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";

const mockGetMissionControlView = vi.fn();
const mockGetProductionVerdictByScan = vi.fn();
const mockGetCurrentProductionVerdict = vi.fn();

vi.mock("../get-mission-control", () => ({
  getMissionControlView: (...args: unknown[]) => mockGetMissionControlView(...args),
}));

vi.mock("@/server/production-verdict/service", () => ({
  getProductionVerdictByScan: (...args: unknown[]) => mockGetProductionVerdictByScan(...args),
  getCurrentProductionVerdict: (...args: unknown[]) => mockGetCurrentProductionVerdict(...args),
}));

const emptyView = { projectId: "p1", header: {}, teams: [] } as never;
const verdict = { status: "not_ready", topPriorities: [] } as never;
const scanLookupAdmin = () => createFakeAdmin({ scans: [] } as never) as never;

describe("loadMissionControlWithRecovery", () => {
  beforeEach(() => {
    mockGetMissionControlView.mockReset();
    mockGetProductionVerdictByScan.mockReset();
    mockGetCurrentProductionVerdict.mockReset();
    mockGetProductionVerdictByScan.mockResolvedValue(null);
    mockGetCurrentProductionVerdict.mockResolvedValue(null);
  });

  it("returns scoped result when run has a verdict", async () => {
    mockGetProductionVerdictByScan.mockResolvedValueOnce(verdict);
    mockGetMissionControlView.mockResolvedValueOnce({ view: emptyView, verdict });

    const result = await loadMissionControlWithRecovery({} as never, "p1", "org1", {
      analysisRunId: "run-1",
      isolationEnabled: true,
      manualRecovery: false,
      admin: null,
    });

    expect(result.runScoped).toBe(true);
    expect(result.verdict).toBe(verdict);
    expect(result.recoveryReason).toBeNull();
    expect(mockGetMissionControlView).toHaveBeenCalledTimes(1);
  });

  it.each(["ready_to_ship", "not_ready"])(
    "keeps a missing scoped verdict pending despite an older %s verdict",
    async (status) => {
      mockGetCurrentProductionVerdict.mockResolvedValue({ ...(verdict as object), status, scanId: "old-run" });
      mockGetMissionControlView.mockResolvedValueOnce({ view: emptyView, verdict: null });

      const result = await loadMissionControlWithRecovery({} as never, "p1", "org1", {
        analysisRunId: "run-1",
        isolationEnabled: true,
        manualRecovery: false,
        admin: scanLookupAdmin(),
      });

      expect(result.runScoped).toBe(true);
      expect(result.verdict).toBeNull();
      expect(result.activeRunId).toBe("run-1");
      expect(mockGetCurrentProductionVerdict).not.toHaveBeenCalled();
      expect(mockGetMissionControlView).toHaveBeenCalledTimes(1);
      expect(mockGetMissionControlView).toHaveBeenCalledWith(
        expect.anything(), "p1", "org1",
        expect.objectContaining({ analysisRunId: "run-1", preloadedVerdict: null })
      );
    }
  );

  it("allows explicit manual recovery to the project view", async () => {
    mockGetMissionControlView.mockResolvedValueOnce({ view: emptyView, verdict });
    const result = await loadMissionControlWithRecovery({} as never, "p1", "org1", {
      analysisRunId: "run-1", isolationEnabled: true, manualRecovery: true, admin: null,
    });
    expect(result.runScoped).toBe(false);
    expect(result.activeRunId).toBeNull();
    expect(result.recoveryReason).toBe("manual_recovery");
    expect(mockGetProductionVerdictByScan).not.toHaveBeenCalled();
  });

  it("loads unscoped when isolation is disabled", async () => {
    mockGetMissionControlView.mockResolvedValueOnce({ view: emptyView, verdict });
    mockGetCurrentProductionVerdict.mockResolvedValueOnce(verdict);

    const result = await loadMissionControlWithRecovery({} as never, "p1", "org1", {
      analysisRunId: "run-1",
      isolationEnabled: false,
      manualRecovery: false,
      admin: null,
    });

    expect(result.runScoped).toBe(false);
    expect(mockGetMissionControlView).toHaveBeenCalledWith(
      expect.anything(),
      "p1",
      "org1",
      expect.objectContaining({ admin: null })
    );
    expect(mockGetMissionControlView.mock.calls[0]?.[3]).not.toHaveProperty("analysisRunId");
  });
});
