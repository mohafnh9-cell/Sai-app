import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelApi, RawFixRecord } from "../api";
import { createAssistedFixController, mergeServerData } from "../controller";
import { isEvidenceCoherent, phaseOf, type PanelData, type PanelFix, type PanelVerification } from "../model";

// Acceptance of 2026-10-13: a correction that failed once (partial: scan missing) was re-reported with a real commit and verified.
// The backend persisted VERIFIED + a passing exact-commit verification, but the card kept showing "No verificada" with the OLD
// attempt's reasons. The card must present a state and evidence that belong together, bound to the same commit.

const SHA = "b".repeat(40);
const OLD_SHA = "0".repeat(40);
const staleVerification: PanelVerification = {
  statement: "not_verified", outcome: "partial", verifiedCommitSha: null, verifiedAnalysis: null,
  reasons: ["verification_scan_missing", "findings_unavailable"], verifiedAt: "2026-10-13T11:05:08Z", commitSha: OLD_SHA,
};
const passedVerification: PanelVerification = {
  statement: "exact_commit_rescan_clean", outcome: "passed", verifiedCommitSha: SHA, verifiedAnalysis: null, reasons: [],
  verifiedAt: "2026-10-13T11:31:52Z", commitSha: SHA,
};
const fix = (over: Partial<PanelFix> = {}): PanelFix => ({
  id: "fix-1", recommendationId: "r", title: "t", severity: null, state: "APPLIED", createdAt: "2026-10-13T10:35:36Z",
  updatedAt: "2026-10-13T11:30:47Z", baseAnalysis: null, reportedCommitSha: SHA, instructions: "", filesToChange: [], verification: staleVerification, ...over,
});
const data = (fixes: PanelFix[]): PanelData => ({ projectId: "p", fixes, suggestion: null, knownAnalyses: [] });
const record = (state: RawFixRecord["lifecycleState"], updatedAt: string): RawFixRecord => ({ id: "fix-1", lifecycleState: state, proposalCommitSha: SHA, updatedAt });
const ok = <T,>(body: T) => ({ ok: true as const, status: 200, body });

function apiWith(over: Partial<PanelApi>): PanelApi {
  return { list: vi.fn(async () => ok({ safeFixes: [record("VERIFIED", "2026-10-13T11:31:52Z")] })), ...over } as unknown as PanelApi;
}

describe("evidence coherence (model)", () => {
  it("VERIFIED needs a PASSED verification for the reported commit", () => {
    expect(isEvidenceCoherent(fix({ state: "VERIFIED", verification: passedVerification }))).toBe(true);
    expect(isEvidenceCoherent(fix({ state: "VERIFIED", verification: staleVerification }))).toBe(false); // negative + other commit
    expect(isEvidenceCoherent(fix({ state: "VERIFIED", verification: { ...staleVerification, commitSha: SHA } }))).toBe(false); // same commit, still a negative
    expect(isEvidenceCoherent(fix({ state: "VERIFIED", verification: { ...passedVerification, commitSha: OLD_SHA } }))).toBe(false); // passed, other commit
    expect(isEvidenceCoherent(fix({ state: "VERIFIED", verification: null }))).toBe(false);
  });
  it("FAILED must not carry a passed verification; rows without a commit are not second-guessed", () => {
    expect(isEvidenceCoherent(fix({ state: "FAILED", verification: staleVerification, reportedCommitSha: OLD_SHA }))).toBe(true);
    expect(isEvidenceCoherent(fix({ state: "FAILED", verification: passedVerification }))).toBe(false);
    expect(isEvidenceCoherent(fix({ state: "VERIFIED", verification: { ...passedVerification, commitSha: undefined } }))).toBe(true);
  });
  it("contradictions are the 'updating' phase, never a verdict", () => {
    expect(phaseOf(fix({ state: "VERIFIED", verification: staleVerification }))).toBe("updating");
    expect(phaseOf(fix({ state: "VERIFIED", verification: passedVerification }))).toBe("verified");
  });
});

describe("transition from a negative to VERIFIED", () => {
  it("shows the verification the route just returned, bound to the commit, not the previous attempt's reasons", async () => {
    const api = apiWith({
      verify: vi.fn(async () => ok({ verification: { statement: "exact_commit_rescan_clean", outcome: "passed", verifiedCommitSha: SHA, details: { reasons: [], proposalCommitSha: SHA } } })),
    });
    const controller = createAssistedFixController({ api, initial: data([fix()]), onReload: vi.fn() });
    await controller.verify("fix-1");
    const shown = controller.getState().data.fixes[0];
    expect(phaseOf(shown)).toBe("verified");
    expect(shown.verification?.reasons).toEqual([]);
    expect(shown.verification?.commitSha).toBe(SHA);
    expect(controller.getState().evidence).toBe("idle");
  });

  it("if the route's answer lacks the evidence, the card says 'updating' (explicit), not the old reasons", async () => {
    const api = apiWith({ verify: vi.fn(async () => ok({ verification: { statement: "exact_commit_rescan_clean", verifiedCommitSha: SHA } })) });
    const controller = createAssistedFixController({ api, initial: data([fix()]), onReload: vi.fn(), reloadDelaysMs: [] });
    await controller.verify("fix-1");
    const shown = controller.getState().data.fixes[0];
    expect(phaseOf(shown)).toBe("updating");
    expect(controller.getState().evidence).toBe("reloading");
  });
});

describe("a card that is contradictory from the start does not depend on one router.refresh()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("initial VERIFIED + old negative: shown as updating, reload is requested repeatedly, then resolves when coherent data is adopted", async () => {
    const onReload = vi.fn();
    const controller = createAssistedFixController({ api: apiWith({}), initial: data([fix({ state: "VERIFIED", verification: staleVerification })]), onReload, reloadDelaysMs: [0, 100, 200] });
    controller.ensureEvidence();
    expect(phaseOf(controller.getState().data.fixes[0])).toBe("updating");
    expect(controller.getState().evidence).toBe("reloading");
    await vi.advanceTimersByTimeAsync(50);
    expect(onReload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); // the first reload did not bring anything: it asks again
    expect(onReload.mock.calls.length).toBeGreaterThanOrEqual(2);
    controller.adopt(data([fix({ state: "VERIFIED", updatedAt: "2026-10-13T11:31:52Z", verification: passedVerification })]));
    expect(phaseOf(controller.getState().data.fixes[0])).toBe("verified");
    expect(controller.getState().evidence).toBe("idle");
    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.getState().evidence).toBe("idle");
  });

  it("reload failure: stays 'updating' (no verdict), then reports the failure; Retry starts over and can succeed", async () => {
    const onReload = vi.fn();
    const controller = createAssistedFixController({ api: apiWith({}), initial: data([fix({ state: "VERIFIED", verification: staleVerification })]), onReload, reloadDelaysMs: [0, 100] });
    controller.ensureEvidence();
    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.getState().evidence).toBe("failed");
    expect(phaseOf(controller.getState().data.fixes[0])).toBe("updating");
    // After the limit, an unrelated re-read must NOT start another round of reloads on its own.
    await controller.refresh(); // (may ask the host for one render because the record changed: that is a single read, not a new round)
    const afterLimit = onReload.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(onReload.mock.calls.length).toBe(afterLimit);
    expect(controller.getState().evidence).toBe("failed");
    const before = onReload.mock.calls.length;
    controller.retryEvidence();
    await vi.advanceTimersByTimeAsync(50);
    expect(onReload.mock.calls.length).toBeGreaterThan(before);
    controller.adopt(data([fix({ state: "VERIFIED", updatedAt: "2026-10-13T11:31:52Z", verification: passedVerification })]));
    expect(controller.getState().evidence).toBe("idle");
    expect(phaseOf(controller.getState().data.fixes[0])).toBe("verified");
  });
});

describe("late and out-of-order responses never roll the card back", () => {
  it("an older list response that arrives after a newer one is dropped", async () => {
    let releaseOld: (value: unknown) => void = () => undefined;
    let call = 0;
    const api = apiWith({
      list: vi.fn(() => {
        call++;
        if (call === 1) return new Promise((resolve) => (releaseOld = resolve)) as never; // slow, stale
        return Promise.resolve(ok({ safeFixes: [record("VERIFIED", "2026-10-13T11:31:52Z")] }));
      }),
    });
    const controller = createAssistedFixController({ api, initial: data([fix({ state: "APPLIED", verification: passedVerification })]), onReload: vi.fn(), reloadDelaysMs: [] });
    const first = controller.refresh();
    await controller.refresh(); // newer: VERIFIED
    expect(controller.getState().data.fixes[0].state).toBe("VERIFIED");
    releaseOld(ok({ safeFixes: [record("APPLIED", "2026-10-13T11:30:47Z")] })); // the old answer finally arrives
    await first;
    expect(controller.getState().data.fixes[0].state).toBe("VERIFIED");
  });

  it("older server props (an older render finishing late) do not roll back state or evidence", () => {
    const local = data([fix({ state: "VERIFIED", updatedAt: "2026-10-13T11:31:52Z", verification: passedVerification })]);
    const olderRender = data([fix({ state: "APPLIED", updatedAt: "2026-10-13T11:30:47Z", verification: staleVerification })]);
    const merged = mergeServerData(local, olderRender).fixes[0];
    expect(merged.state).toBe("VERIFIED");
    expect(merged.verification).toEqual(passedVerification);
    expect(phaseOf(merged)).toBe("verified");
  });

  it("fresh server data that carries newer evidence wins over what we hold", () => {
    const local = data([fix({ state: "VERIFIED", updatedAt: "2026-10-13T11:31:52Z", verification: staleVerification })]);
    const fresh = data([fix({ state: "VERIFIED", updatedAt: "2026-10-13T11:31:52Z", verification: passedVerification })]);
    expect(phaseOf(mergeServerData(local, fresh).fixes[0])).toBe("verified");
  });
});
