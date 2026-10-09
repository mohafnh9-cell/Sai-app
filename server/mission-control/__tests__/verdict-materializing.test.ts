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

  it("scoped run completed seconds ago with no verdict while an older verdict exists -> verdict null + verdict_materializing; the older verdict is never read", async () => {
    getCurrentProductionVerdict.mockResolvedValue({ scanId: "older", status: "not_ready" });
    const result = await load(admin({}));
    expect(result.verdict).toBeNull();
    expect(getCurrentProductionVerdict).not.toHaveBeenCalled();
    expect(result.recoveryReason).toBe("verdict_materializing");
    expect(shouldPollMissionControl(pollState(result.recoveryReason))).toBe(true);
  });

  it("a historical scoped run (outside the window) with no verdict stays empty: no substitution, no polling", async () => {
    getCurrentProductionVerdict.mockResolvedValue({ scanId: "older", status: "ready_to_ship" });
    const result = await load(admin({ completed_at: ago(VERDICT_MATERIALIZATION_WINDOW_MS + 5_000) }));
    expect(result.verdict).toBeNull();
    expect(result.recoveryReason).toBeNull();
    expect(shouldPollMissionControl(pollState(result.recoveryReason))).toBe(false);
  });
});

describe("deterministic poll loop: scan active -> scan completes -> verdict persisted -> new verdict appears (bounded)", () => {
  // Simulates the client's refetchInterval: poll while shouldPollMissionControl(state), at most one fetch per tick.
  async function pollUntilSettled(load: () => Promise<{ recoveryReason: string | null; verdict: unknown }>, reviewInProgress: () => boolean, maxTicks: number) {
    const trace: Array<{ reason: string | null; hasVerdict: boolean; review: boolean }> = [];
    for (let tick = 0; tick < maxTicks; tick += 1) {
      const result = await load();
      const review = reviewInProgress();
      trace.push({ reason: result.recoveryReason, hasVerdict: result.verdict != null, review });
      if (!shouldPollMissionControl(pollState(result.recoveryReason, review))) break;
    }
    return trace;
  }

  it("keeps polling while the scan runs, through the verdict lag, then stops exactly when the verdict appears", async () => {
    type Phase = "running" | "completed_no_verdict" | "persisted";
    let phase: Phase = "running" as Phase;
    const verdict = { scanId: SCAN, status: "not_ready" };
    const load = async () => {
      if (phase === "persisted") {
        getProductionVerdictByScan.mockResolvedValue(verdict);
        getMissionControlView.mockResolvedValue({ view: {}, verdict });
        return load0(admin({}));
      }
      return load0(admin(phase === "running" ? { status: "running", completed_at: null } : {}));
    };
    const load0 = (a: never) => loadMissionControlWithRecovery({} as never, PROJECT, ORG, { analysisRunId: SCAN, isolationEnabled: true, manualRecovery: false, admin: a });
    const script: Phase[] = ["running", "running", "completed_no_verdict", "completed_no_verdict", "persisted"];
    let i = 0;
    const trace: Array<{ reason: string | null; hasVerdict: boolean; review: boolean }> = [];
    while (i < script.length) {
      phase = script[i]!;
      const result = await load();
      const review = phase === "running"; // the live review state is what keeps polling during the run
      trace.push({ reason: result.recoveryReason, hasVerdict: result.verdict != null, review });
      i += 1;
      if (!shouldPollMissionControl(pollState(result.recoveryReason, review))) break;
    }
    expect(trace).toEqual([
      { reason: null, hasVerdict: false, review: true },
      { reason: null, hasVerdict: false, review: true },
      { reason: "verdict_materializing", hasVerdict: false, review: false },
      { reason: "verdict_materializing", hasVerdict: false, review: false },
      { reason: null, hasVerdict: true, review: false }, // new verdict appears; polling stops here
    ]);
  });

  it("is bounded: a verdict that never materializes ends polling within the window (no infinite loop)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
      const completedAt = new Date().toISOString();
      const a = () => admin({ completed_at: completedAt });
      const trace = await pollUntilSettled(
        async () => {
          const r = await loadMissionControlWithRecovery({} as never, PROJECT, ORG, { analysisRunId: SCAN, isolationEnabled: true, manualRecovery: false, admin: a() });
          vi.advanceTimersByTime(4_000); // one POLL_INTERVAL_MS per tick
          return r;
        },
        () => false,
        1_000
      );
      expect(trace.length).toBeGreaterThan(1);
      expect(trace.length).toBeLessThanOrEqual(Math.ceil(VERDICT_MATERIALIZATION_WINDOW_MS / 4_000) + 2);
      expect(trace[trace.length - 1]).toMatchObject({ reason: null, hasVerdict: false });
    } finally {
      vi.useRealTimers();
    }
  });
});


describe("previous verdict + newer completed scan still writing its verdict (stale-verdict window)", () => {
  const OLD = "99999999-9999-4999-8999-999999999991";
  const oldVerdict = { scanId: OLD, status: "ready_to_ship" };

  it("unscoped load: the older READY verdict is flagged verdict_materializing, so polling continues and the UI marks it outdated", async () => {
    getMissionControlView.mockResolvedValue({ view: {}, verdict: oldVerdict });
    const result = await load(admin({}), { analysisRunId: null });
    expect(result.recoveryReason).toBe("verdict_materializing");
    expect(shouldPollMissionControl(pollState(result.recoveryReason))).toBe(true);
  });

  it("once the newer scan's verdict is the current one the flag clears and polling stops", async () => {
    getMissionControlView.mockResolvedValue({ view: {}, verdict: { scanId: SCAN, status: "ready_to_ship" } });
    const result = await load(admin({}), { analysisRunId: null });
    expect(result.recoveryReason).toBeNull();
  });

  it("bounded: a newer scan whose verdict never arrives stops being 'materializing' after the window", async () => {
    getMissionControlView.mockResolvedValue({ view: {}, verdict: oldVerdict });
    const result = await load(admin({ completed_at: ago(VERDICT_MATERIALIZATION_WINDOW_MS + 5_000) }), { analysisRunId: null });
    expect(result.recoveryReason).toBeNull();
  });

  it("a failed newer scan does not mask the current verdict", async () => {
    getMissionControlView.mockResolvedValue({ view: {}, verdict: oldVerdict });
    const result = await load(admin({ status: "failed", completed_at: null }), { analysisRunId: null });
    expect(result.recoveryReason).toBeNull();
  });
});

describe("scoped and unscoped Mission Control agree on the materialization gap", () => {
  const OLD = "99999999-9999-4999-8999-999999999992";
  for (const status of ["ready_to_ship", "not_ready"]) {
    it(`previous ${status} + newer completed scan without verdict -> both paths report verdict_materializing and the scoped path exposes no verdict`, async () => {
      const previous = { scanId: OLD, status };
      getCurrentProductionVerdict.mockResolvedValue(previous);
      getMissionControlView.mockResolvedValue({ view: {}, verdict: previous });
      const scoped = await load(admin({}));
      const unscoped = await load(admin({}), { analysisRunId: null });
      expect(scoped.recoveryReason).toBe("verdict_materializing");
      expect(scoped.verdict).toBeNull();
      expect(unscoped.recoveryReason).toBe("verdict_materializing");
    });
  }

  it("clears when the scoped verdict arrives; failed/cancelled scoped runs are not materializing", async () => {
    getCurrentProductionVerdict.mockResolvedValue({ scanId: OLD, status: "ready_to_ship" });
    for (const status of ["failed", "cancelled"]) {
      const failed = await load(admin({ status, completed_at: null }));
      expect(failed.recoveryReason).toBeNull();
      expect(failed.verdict).toBeNull();
    }
    getProductionVerdictByScan.mockResolvedValue({ scanId: SCAN, status: "ready_to_ship" });
    expect((await load(admin({}))).recoveryReason).toBeNull();
  });
});
