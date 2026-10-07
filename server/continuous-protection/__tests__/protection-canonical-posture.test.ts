import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getProtectionCenterModel } from "../protection-context";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
import { safeFixOffer } from "@/brain/production-verdict/safe-fix-eligibility";
import { protectionDecisionFor } from "@/brain/production-verdict/protection-decision";

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "99999999-9999-4999-8999-999999999999";
const SCAN = "22222222-2222-4222-8222-222222222221";
const area = (key: string) => ({ key, label: key, score: null, status: "not_evaluated", confidence: "low", limitations: "", methodology: "", evidenceCount: 0 });
const priority = (over: Record<string, unknown> = {}) => ({
  id: "priority-1-security", rank: 1, title: "Fix injection and input validation risks", category: "security", reason: "r",
  severity: "critical", confidence: "high", estimatedMinutes: 10, estimatedTimeLabel: "10 min",
  projectedScoreImpact: 5, affectedFiles: ["src/a.ts"], recommendedAction: "Use parameterized queries.", findingIds: ["f1"], ...over,
});

type World = { verdict?: Record<string, unknown> | null; activeScanId?: string | null; findings?: Array<Record<string, unknown>>; defaultBranch?: string | null; extra?: Record<string, unknown[]> };

function world(w: World = {}): { admin: never; tables: FakeTables } {
  const verdict = w.verdict === null ? null : buildVerdictFixture({
    projectId: PROJECT, repositoryId: PROJECT, scanId: SCAN, commitSha: "ce0ea7e", branch: "main",
    status: "not_ready", score: 0, confidence: "low", blockersCount: 10, criticalBlockersCount: 1, highBlockersCount: 9,
    topPriorities: [priority()] as never, ...(w.verdict ?? {}),
  } as never);
  const tables = {
    projects: [{ id: PROJECT, organization_id: ORG, github_repo: "o/tokenai", github_repository_id: 1, github_default_branch: w.defaultBranch === undefined ? "main" : w.defaultBranch }],
    project_continuous_protection: [{ project_id: PROJECT, enabled: true, paused_at: null, last_daily_completed_at: new Date().toISOString(), consecutive_daily_failures: 0 }],
    repository_sync_status: [{ project_id: PROJECT, connection_status: "connected", commit_sha: "ce0ea7e" }],
    project_memory_profile: [{ project_id: PROJECT, first_protected_at: "2026-10-05T14:24:45Z" }],
    production_verdicts: verdict ? [verdictRow(PROJECT, verdict, "33333333-3333-4333-8333-333333330001", ORG)] : [],
    repository_scan_state: [{ repository_id: PROJECT, organization_id: ORG, active_scan_id: w.activeScanId ?? null, last_scan_id: verdict ? SCAN : null, current_verdict_id: verdict ? "33333333-3333-4333-8333-333333330001" : null }],
    protection_snapshots: [],
    protection_weekly_summaries: [],
    scan_findings: w.findings ?? [{ id: "f1", project_id: PROJECT, scan_id: SCAN, status: "open", recommendation: "Use parameterized queries." }],
  } as unknown as FakeTables;
  Object.assign(tables, w.extra ?? {});
  return { admin: createFakeAdmin(tables) as never, tables };
}

const model = (w?: World) => getProtectionCenterModel(world(w).admin, PROJECT);

describe("Protection Status is a projection of the canonical verdict (never its own decision)", () => {
  it("A. no verdict -> explicit non-decision: no posture, no scores, no concerns, no recommendation, no Safe Fix", async () => {
    const m = await model({ verdict: null });
    expect(m?.decision).toEqual({ state: "no_verdict" });
    expect(m?.status).toBe("NOT_PROTECTED");
    expect(m).toMatchObject({ productionConfidence: null, securityConfidence: null, worriesTop3: [], recommendation: "", safeFix: null });
  });

  it("B. a scan in progress -> analysis_in_progress even if an older verdict exists", async () => {
    const m = await model({ activeScanId: "scan-running" });
    expect(m?.decision).toEqual({ state: "analysis_in_progress" });
    expect(m?.worriesTop3).toEqual([]);
    expect(m?.safeFix).toBeNull();
    expect(m?.recommendation).toBe("");
  });

  it("C. verdict NOT_READY -> posture not_ready, status never SAFE_WITH_CAUTION (TokenAi: not_ready, low confidence, 10 blockers)", async () => {
    const m = await model();
    expect(m?.decision).toMatchObject({ state: "verdict", posture: "not_ready", verdictStatus: "not_ready", confidence: "low", commitSha: "ce0ea7e" });
    expect(m?.status).toBe("REQUIRES_ATTENTION");
    expect(m?.status).not.toBe("SAFE_WITH_CAUTION");
    expect(m?.worriesTop3).toEqual(["Fix injection and input validation risks"]);
  });

  it("D/E. verdict INSUFFICIENT_DATA / analysis_failed (MORE_ANALYSIS_REQUIRED) -> reflects insufficient evidence, no affirmative status", async () => {
    for (const status of ["insufficient_data", "analysis_failed"] as const) {
      const m = await model({ verdict: { status } });
      expect(m?.decision).toMatchObject({ state: "verdict", posture: "more_analysis_required" });
      expect(m?.status).toBe("REQUIRES_ATTENTION");
    }
  });

  it("E'. READY with low confidence or unevaluated areas -> no affirmative language", async () => {
    const limited = await model({ verdict: { status: "ready_to_ship", confidence: "low", blockersCount: 0, topPriorities: [] } });
    expect(limited?.decision).toMatchObject({ posture: "ready_evidence_limited" });
    expect(limited?.status).not.toBe("PROTECTED");
    const partial = await model({ verdict: { status: "ready_to_ship", confidence: "high", blockersCount: 0, topPriorities: [], unevaluatedAreas: [area("testing")] } });
    expect(partial?.decision).toMatchObject({ posture: "ready_evidence_limited" });
    expect(partial?.status).not.toBe("PROTECTED");
  });

  it("F. READY with high confidence + complete coverage -> ready (the only PROTECTED)", async () => {
    const m = await model({ verdict: { status: "ready_to_ship", confidence: "high", score: 100, blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, topPriorities: [], unevaluatedAreas: [], partiallyEvaluatedAreas: [] } });
    expect(m?.decision).toMatchObject({ state: "verdict", posture: "ready" });
    expect(m?.status).toBe("PROTECTED");
  });

  it("G. the recommendation is the verdict's own recommended action, never a status-keyed static string", async () => {
    const m = await model({ verdict: { recommendedAction: "Do not ship until production blockers are resolved." } });
    expect(m?.recommendation).toBe("Do not ship until production blockers are resolved.");
    expect(m?.recommendation).not.toMatch(/Apply Safe Fix\./);
  });
});

describe("Safe Fix is offered only for a real, current, supported finding", () => {
  it("A. eligible deterministic finding -> offered (title of the verdict's top priority)", async () => {
    const m = await model();
    expect(m?.safeFix).toEqual({ title: "Fix injection and input validation risks", findingCount: 1 });
  });
  it("B. a verdict with no findings behind its priorities -> unavailable", async () => {
    const m = await model({ verdict: { topPriorities: [] } });
    expect(m?.safeFix).toBeNull();
    const none = await model({ findings: [] });
    expect(none?.safeFix).toBeNull();
  });
  it("C. finding from a previous scan only -> unavailable", async () => {
    const m = await model({ findings: [{ id: "f1", project_id: PROJECT, scan_id: "00000000-0000-4000-8000-0000000000aa", status: "open", recommendation: "r" }] });
    expect(m?.safeFix).toBeNull();
  });
  it("D. verdict from another branch -> unavailable", async () => {
    const m = await model({ verdict: { branch: "feature/x" } });
    expect(m?.safeFix).toBeNull();
  });
  it("E. finding belonging to another project -> unavailable", async () => {
    const m = await model({ findings: [{ id: "f1", project_id: OTHER_PROJECT, scan_id: SCAN, status: "open", recommendation: "r" }] });
    expect(m?.safeFix).toBeNull();
  });
  it("F. unsupported finding (no deterministic remediation) or already resolved -> unavailable", async () => {
    expect((await model({ findings: [{ id: "f1", project_id: PROJECT, scan_id: SCAN, status: "open", recommendation: "" }] }))?.safeFix).toBeNull();
    expect((await model({ findings: [{ id: "f1", project_id: PROJECT, scan_id: SCAN, status: "resolved", recommendation: "r" }] }))?.safeFix).toBeNull();
  });
  it("never offered on a ready verdict, nor when the verdict is not the current scan's", () => {
    const verdict = buildVerdictFixture({ projectId: PROJECT, scanId: SCAN, status: "ready_to_ship", topPriorities: [priority()] as never } as never);
    const rows = [{ id: "f1", project_id: PROJECT, scan_id: SCAN, status: "open", recommendation: "r" }];
    expect(safeFixOffer({ projectId: PROJECT, currentScanId: SCAN, defaultBranch: "main", verdict, findings: rows })).toBeNull();
    const notReady = buildVerdictFixture({ projectId: PROJECT, scanId: SCAN, status: "not_ready", branch: "main", topPriorities: [priority()] as never } as never);
    expect(safeFixOffer({ projectId: PROJECT, currentScanId: "some-other-scan", defaultBranch: "main", verdict: notReady, findings: rows })).toBeNull();
    expect(safeFixOffer({ projectId: PROJECT, currentScanId: SCAN, defaultBranch: "main", verdict: notReady, findings: rows })).not.toBeNull();
  });
});

describe("protectionDecisionFor", () => {
  it("is a pure projection: in-progress beats everything, no verdict is a non-decision", () => {
    const verdict = buildVerdictFixture({ projectId: PROJECT, status: "not_ready" } as never);
    expect(protectionDecisionFor({ verdict, reviewInProgress: true })).toEqual({ state: "analysis_in_progress" });
    expect(protectionDecisionFor({ verdict: null, reviewInProgress: false })).toEqual({ state: "no_verdict" });
    expect(protectionDecisionFor({ verdict, reviewInProgress: false })).toMatchObject({ state: "verdict", posture: "not_ready" });
  });
});

describe("Protection Status during an active scan (Phase 8I.1)", () => {
  // The live-E2E shape: a new scan is running (scan_jobs row), repository_scan_state.active_scan_id is NOT set,
  // and the previous scan's verdict is still the current one.
  const NEW_SCAN = "44444444-4444-4444-8444-444444444444";
  const running = {
    scan_jobs: [{ id: "job-1", organization_id: ORG, project_id: PROJECT, scan_id: NEW_SCAN, status: "running", created_at: new Date().toISOString() }],
    scans: [{ id: NEW_SCAN, repository_id: PROJECT, project_id: PROJECT, organization_id: ORG, branch: "main", status: "fetching_repository", commit_sha: "d1e1211", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), started_at: new Date().toISOString(), queued_at: new Date().toISOString() }],
  };
  const previous = { status: "ready_to_ship", confidence: "low", blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, score: 100, topPriorities: [], unevaluatedAreas: [area("testing")] };

  it("D. active scan + a previous verdict: explicit in-progress / no final decision, previous posture is NOT projected", async () => {
    const m = await model({ verdict: previous, extra: running });
    expect(m?.decision).toEqual({ state: "analysis_in_progress" });
    expect(m?.status).not.toBe("PROTECTED");
    expect(m).toMatchObject({ safeFix: null, recommendation: "", worriesTop3: [], productionConfidence: null, securityConfidence: null });
  });

  it("D'. an in-progress scan on another branch does not hide the default branch's verdict (branch isolation)", async () => {
    const other = { ...running, scans: [{ ...running.scans[0], branch: "feature/x" }] };
    const m = await model({ verdict: previous, extra: other });
    expect(m?.decision).toMatchObject({ state: "verdict", posture: "ready_evidence_limited" });
  });

  it("E. scan completed + new verdict persisted: Protection shows the NEW canonical posture, bound to the new scan and commit", async () => {
    const completed = {
      scan_jobs: [{ ...running.scan_jobs[0], status: "completed" }],
      scans: [{ ...running.scans[0], status: "completed", completed_at: new Date().toISOString() }],
    };
    const m = await model({ verdict: { ...previous, scanId: NEW_SCAN, commitSha: "d1e1211" }, extra: completed });
    expect(m?.decision).toMatchObject({ state: "verdict", posture: "ready_evidence_limited", scanId: NEW_SCAN, commitSha: "d1e1211" });
    expect(m?.status).toBe("REQUIRES_ATTENTION");
  });

  it("E'. the transition is ordered: running -> in progress; then persisted verdict -> canonical posture (never skips to approval)", async () => {
    const during = await model({ verdict: previous, extra: running });
    const after = await model({ verdict: { ...previous, scanId: NEW_SCAN, commitSha: "d1e1211", status: "not_ready", blockersCount: 3, confidence: "low" } });
    expect(during?.decision.state).toBe("analysis_in_progress");
    expect(after?.decision).toMatchObject({ state: "verdict", posture: "not_ready", scanId: NEW_SCAN });
  });
});

describe("current TokenAi-shaped posture stays conservative (Phase 8I.2)", () => {
  it("E. insufficient_data + LOW + 10 blockers: more_analysis_required, never protected / safe / ready", async () => {
    const m = await model({ verdict: { status: "insufficient_data", score: 32, confidence: "low", blockersCount: 10, criticalBlockersCount: 1, highBlockersCount: 9 } });
    expect(m?.decision).toMatchObject({ state: "verdict", posture: "more_analysis_required", verdictStatus: "insufficient_data", confidence: "low" });
    expect(m?.status).toBe("REQUIRES_ATTENTION");
    expect(m?.status).not.toBe("PROTECTED");
    expect(m?.status).not.toBe("SAFE_WITH_CAUTION");
    // Safe Fix only for the real, current-scan finding
    expect(m?.safeFix).toMatchObject({ findingCount: 1 });
  });
});

