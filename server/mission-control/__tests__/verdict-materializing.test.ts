import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getMissionControlView = vi.fn();
const getCurrentProductionVerdict = vi.fn();
const getProductionVerdictByScan = vi.fn();
vi.mock("../get-mission-control", () => ({ getMissionControlView: (...a: unknown[]) => getMissionControlView(...a) }));
vi.mock("@/server/production-verdict/service", () => ({
  getCurrentProductionVerdict: (...a: unknown[]) => getCurrentProductionVerdict(...a),
  getProductionVerdictByScan: (...a: unknown[]) => getProductionVerdictByScan(...a),
}));

import {
  isVerdictMaterializing,
  loadMissionControlWithRecovery,
  VERDICT_MATERIALIZATION_WINDOW_MS,
} from "../load-mission-control-with-recovery";
import { shouldPollMissionControl } from "@/features/mission-control/hooks/useMissionControlState";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SCAN = "22222222-2222-4222-8222-222222222222";
const ORG = "org-a";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function admin(scanOver: Record<string, unknown> | null) {
  const tables = {
    projects: [{ id: PROJECT, organization_id: ORG, github_default_branch: "main" }],
    scans: scanOver
      ? [{ id: SCAN, project_id: PROJECT, repository_id: PROJECT, branch: "main", status: "completed", completed_at: ago(10_000), ...scanOver }]
      : [],
  } as unknown as FakeTables;
  return createFakeAdmin(tables) as never;
}

const load = (a: never, over: { analysisRunId?: string | null } = {}) =>
  loadMissionControlWithRecovery({} as never, PROJECT, ORG, {
    analysisRunId: over.analysisRunId === undefined ? SCAN : over.analysisRunId,
    isolationEnabled: true,
    manualRecovery: false,
    admin: a,
  });

const pollState = (recoveryReason: string | null, reviewInProgress = false) =>
  ({ recoveryReason, status: { reviewInProgress, securityRunning: false } }) as never;

beforeEach(() => {
  getMissionControlView.mockReset().mockResolvedValue({ view: {}, verdict: null });
  getCurrentProductionVerdict.mockReset().mockResolvedValue(null);
  getProductionVerdictByScan.mockReset().mockResolvedValue(null);
});

describe("isVerdictMaterializing (bounded)", () => {
  it("true only for a completed scan inside the window", () => {
    expect(isVerdictMaterializing({ status: "completed", completed_at: ago(5_000) })).toBe(true);
    expect(isVerdictMaterializing({ status: "completed", completed_at: ago(VERDICT_MATERIALIZATION_WINDOW_MS + 1_000) })).toBe(false);
  });
  it("false for failed / cancelled / running scans, missing or unparsable completion, and no scan", () => {
    for (const status of ["failed", "cancelled", "running", "queued"]) {
      expect(isVerdictMaterializing({ status, completed_at: ago(1_000) })).toBe(false);
    }
    expect(isVerdictMaterializing({ status: "completed", completed_at: null })).toBe(false);
    expect(isVerdictMaterializing({ status: "completed", completed_at: "not-a-date" })).toBe(false);
    expect(isVerdictMaterializing(null)).toBe(false);
  });
});

describe("Mission Control keeps polling through the scan-completed -> verdict-persisted gap", () => {
  it("1-4. scan completed, verdict not yet persisted: a polling cycle keeps polling; once the verdict appears the UI gets it and polling stops", async () => {
    // cycle 1: scan completed 10 s ago, no verdict anywhere (first scan of the project)
    const first = await load(admin({}));
    expect(first.verdict).toBeNull();
    expect(first.recoveryReason).toBe("verdict_materializing");
    expect(shouldPollMissionControl(pollState(first.recoveryReason))).toBe(true);

    // cycle 2: the verdict has materialized
    const verdict = { scanId: SCAN, status: "not_ready" };
    getProductionVerdictByScan.mockResolvedValue(verdict);
    getMissionControlView.mockResolvedValue({ view: {}, verdict });
    const second = await load(admin({}));
    expect(second.verdict).toBe(verdict);
    expect(second.recoveryReason).toBeNull();
    expect(shouldPollMissionControl(pollState(second.recoveryReason))).toBe(false);
  });

  it("the unscoped load (no run id) is covered too: latest completed default-branch scan, no verdict yet", async () => {
    const result = await load(admin({}), { analysisRunId: null });
    expect(result.recoveryReason).toBe("verdict_materializing");
  });

  it("scan failure is terminal: no materializing state, no infinite polling", async () => {
    const result = await load(admin({ status: "failed", completed_at: null }));
    expect(result.recoveryReason).toBeNull();
    expect(shouldPollMissionControl(pollState(result.recoveryReason))).toBe(false);
  });

  it("verdict never materializes: after the window the state is terminal (timeout), not an infinite poll", async () => {
    const result = await load(admin({ completed_at: ago(VERDICT_MATERIALIZATION_WINDOW_MS + 5_000) }));
    expect(result.recoveryReason).toBeNull();
    expect(shouldPollMissionControl(pollState(result.recoveryReason))).toBe(false);
  });

  it("genuinely no scan and no verdict -> plain empty state, no polling", async () => {
    const result = await load(admin(null));
    expect(result.recoveryReason).toBeNull();
    expect(shouldPollMissionControl(pollState(result.recoveryReason))).toBe(false);
  });

  it("an active review still polls; manual recovery is not overridden", async () => {
    expect(shouldPollMissionControl(pollState(null, true))).toBe(true);
    getMissionControlView.mockResolvedValue({ view: {}, verdict: null });
    const manual = await loadMissionControlWithRecovery({} as never, PROJECT, ORG, {
      analysisRunId: SCAN, isolationEnabled: true, manualRecovery: true, admin: admin({}),
    });
    expect(manual.recoveryReason).toBe("manual_recovery");
  });

  it("a verdict from the existing fallback ladder is untouched (current verdict while the scoped run has none)", async () => {
    getCurrentProductionVerdict.mockResolvedValue({ scanId: "older", status: "not_ready" });
    const result = await load(admin({}));
    expect(result.recoveryReason).toBe("scoped_verdict_missing");
  });
});
