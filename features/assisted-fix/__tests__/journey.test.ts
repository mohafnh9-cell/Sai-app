import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/observability/metrics", () => ({ incrementMetricCounter: vi.fn() }));
vi.mock("@/server/observability/operation-timing", () => ({
  withOperationTiming: async (_name: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/server/safe-fix-engine/memory-bridge", () => ({ appendSafeFixMemoryEvent: vi.fn(async () => undefined) }));
vi.mock("@/server/continuous-protection/protection-context", () => ({ loadProtectionContext: vi.fn(async () => null) }));

import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
import { matchKeysForNativeFinding } from "@/server/safe-fix-engine/finding-identity";
import { generateSafeFix } from "@/server/safe-fix-engine/generate";
import { listSafeFixHistory } from "@/server/safe-fix-engine/history";
import { mapSafeFixError } from "@/server/safe-fix-engine/http-errors";
import { loadAssistedFixPanelData } from "@/server/safe-fix-engine/panel-data";
import { approveSafeFix, markSafeFixApplied, reopenSafeFix, verifySafeFix } from "@/server/safe-fix-engine/verify";
import type { ApiResult, PanelApi } from "../api";
import { createAssistedFixController } from "../controller";
import { phaseOf } from "../model";

// The whole assisted journey, driven through the panel's controller over the REAL engine functions and an in-memory database:
//   generate -> approve -> report the commit (never preselected, explicitly confirmed) -> verify -> verified (exact commit)
// plus the negatives. The route handlers have their own tests; this proves the panel's behaviour end to end without a browser.

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const BASE_SCAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIX_SCAN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BASE_SHA = "a".repeat(40);
const FIX_SHA = "b".repeat(40);
const UNSCANNED_SHA = "d".repeat(40);
const PRIORITY = "priority-1";
const scope = { organizationId: ORG, projectId: PROJECT };

const F1 = { id: "f1", fingerprint: "fp-1", rule: "authz.ownership", path: "app/api/orders/route.ts", title: "Missing ownership check" };
const F2 = { id: "f2", fingerprint: "fp-2", rule: "injection.sql", path: "lib/db.ts", title: "SQL built from input" };
const finding = (scanId: string, f: typeof F1, suffix = "") => ({ id: `${f.id}${suffix}`, scan_id: scanId, project_id: PROJECT, fingerprint: f.fingerprint, rule_id: f.rule, file_path: f.path, title: f.title, metadata: null });
const scanRow = (id: string, sha: string, over: Record<string, unknown> = {}) => ({
  id, status: "completed", created_at: "2026-03-05T00:00:00.000Z", completed_at: "2026-03-05T00:01:00.000Z", commit_sha: sha, branch: "main",
  project_id: PROJECT, repository_id: PROJECT, organization_id: ORG, metrics: { rulesRun: 47, ruleFailures: 0 }, omissions: [], detected_stack: {}, ...over,
});

function world() {
  const baseVerdict = buildVerdictFixture({
    projectId: PROJECT, repositoryId: PROJECT, scanId: BASE_SCAN, commitSha: BASE_SHA, status: "not_ready", score: 50, blockersCount: 2, generatedAt: "2026-03-01T00:00:00.000Z",
    topPriorities: [{ id: PRIORITY, title: "Missing ownership check", rank: 1, severity: "high", category: "authorization", reason: "r", confidence: "high",
      estimatedMinutes: 10, estimatedTimeLabel: "10 minutes", projectedScoreImpact: 10, recommendedAction: "Add an ownership check before returning the resource.", findingIds: ["f1"], affectedFiles: ["app/api/orders/route.ts"] }],
  });
  const fixVerdict = buildVerdictFixture({
    projectId: PROJECT, repositoryId: PROJECT, scanId: FIX_SCAN, commitSha: FIX_SHA, status: "almost_ready", score: 92, blockersCount: 1, topPriorities: [], generatedAt: "2026-03-05T00:00:00.000Z",
  });
  const tables = {
    scans: [scanRow(BASE_SCAN, BASE_SHA, { created_at: "2026-03-01T00:00:00.000Z", completed_at: "2026-03-01T00:01:00.000Z", metrics: {} }), scanRow(FIX_SCAN, FIX_SHA)],
    scan_findings: [finding(BASE_SCAN, F1), finding(BASE_SCAN, F2), finding(FIX_SCAN, F2, "-fix")],
    external_engine_findings: [],
    security_jobs: ["opengrep", "trivy", "crypto"].map((engine, i) => ({ id: `job-${i}`, scan_id: FIX_SCAN, organization_id: ORG, engine, status: "COMPLETED" })),
    production_verdicts: [
      verdictRow(PROJECT, baseVerdict, "d0000000-0000-4000-8000-000000000001", ORG),
      verdictRow(PROJECT, fixVerdict, "d0000000-0000-4000-8000-000000000002", ORG),
    ],
    repository_scan_state: [{ repository_id: PROJECT, organization_id: ORG, current_verdict_id: "d0000000-0000-4000-8000-000000000002", last_scan_id: FIX_SCAN, active_scan_id: null }],
    repository_sync_status: [{ project_id: PROJECT, organization_id: ORG, branch: "main", commit_sha: FIX_SHA, detected_at: "2026-03-05T00:00:30.000Z" }],
    safe_fix_records: [], safe_fix_lifecycle_events: [], safe_fix_verifications: [], projects: [{ id: PROJECT, organization_id: ORG, name: "demo" }],
  } as unknown as FakeTables;
  return { tables, admin: createFakeAdmin(tables) as never };
}
void matchKeysForNativeFinding;

function engineApi(admin: never) {
  const calls: Record<string, number> = { generate: 0, approve: 0, applied: 0, verify: 0, reopen: 0 };
  const sent: Array<{ action: string; commitSha?: string }> = [];
  const wrap = async <T>(fn: () => Promise<{ status?: number; body: T }>): Promise<ApiResult<T>> => {
    try {
      const { status, body } = await fn();
      return { ok: true, status: status ?? 200, body };
    } catch (error) {
      const mapped = mapSafeFixError(error);
      if (!mapped) throw error;
      return { ok: false, status: mapped.status, code: mapped.error };
    }
  };
  const api: PanelApi = {
    list: () => wrap(async () => ({ body: { safeFixes: await listSafeFixHistory(admin, scope) as never } })),
    generate: (input) => wrap(async () => {
      calls.generate++;
      const result = await generateSafeFix(admin, { ...scope, projectName: "demo", priorityId: input.priorityId, analysisRunId: BASE_SCAN, actor: "user" });
      return { status: result.status === "in_flight" ? 409 : 200, body: { result: result as never } };
    }),
    approve: (id) => wrap(async () => { calls.approve++; sent.push({ action: "approve" }); await approveSafeFix(admin, { safeFixId: id, ...scope, actor: "user" }); return { body: { state: "APPROVED" } }; }),
    applied: (id, commitSha) => wrap(async () => { calls.applied++; sent.push({ action: "applied", commitSha }); const { binding } = await markSafeFixApplied(admin, { safeFixId: id, ...scope, actor: "user", commitSha }); return { body: { state: "APPLIED", binding } }; }),
    verify: (id) => wrap(async () => {
      calls.verify++; sent.push({ action: "verify" });
      const records = await listSafeFixHistory(admin, scope);
      const existing = records.find((r) => r.id === id);
      if (!existing || existing.lifecycleState !== "APPLIED") throw new Error(`invalid_transition:${existing?.lifecycleState}->VERIFYING`);
      const verification = await verifySafeFix(admin, { safeFixId: id, ...scope, analysisRunId: null, actor: "user" });
      return { body: { verification: verification as never } };
    }),
    reopen: (id) => wrap(async () => { calls.reopen++; await reopenSafeFix(admin, { safeFixId: id, ...scope, actor: "user" }); return { body: { state: "READY" } }; }),
  };
  return { api, calls, sent };
}

async function setup() {
  const { tables, admin } = world();
  const harness = engineApi(admin);
  const initial = await loadAssistedFixPanelData(admin, scope);
  let controller: ReturnType<typeof createAssistedFixController>;
  const reloads: Promise<void>[] = [];
  controller = createAssistedFixController({
    api: harness.api, initial,
    onReload: () => { reloads.push(loadAssistedFixPanelData(admin, scope).then((data) => controller.adopt(data))); },
  });
  const settle = async () => { await Promise.all(reloads.splice(0)); };
  const only = () => controller.getState().data.fixes[0];
  return { tables, admin, controller, harness, settle, only };
}

describe("assisted correction journey (real engine, in-memory database)", () => {
  it("starts with no proposals and only a SUGGESTION of the latest detected commit (never selected)", async () => {
    const { controller } = await setup();
    const state = controller.getState();
    expect(state.data.fixes).toEqual([]);
    expect(state.data.suggestion).toMatchObject({ branch: "main", commitSha: FIX_SHA, analysis: { scanId: FIX_SCAN, commitSha: FIX_SHA } });
    expect(state.commitFlow).toBeNull();
  });

  it("generate -> approve -> report the commit -> verify: a verified correction ONLY at the end, bound to the exact commit", async () => {
    const { controller, harness, settle, only } = await setup();

    await controller.generate(); // no id: the existing route asks which blocker
    expect(controller.getState().chooseBlocker?.map((b) => b.id)).toEqual([PRIORITY]);
    await controller.generate(PRIORITY);
    await settle();
    expect(controller.getState().notice).toBe("created");
    expect(phaseOf(only())).toBe("proposal"); // documentary proposal: not a correction
    expect(only().baseAnalysis).toMatchObject({ scanId: BASE_SCAN, commitSha: BASE_SHA, branch: "main" });
    expect(only().instructions.length).toBeGreaterThan(20);

    await controller.approve(only().id);
    expect(only().state).toBe("APPROVED");
    expect(phaseOf(only())).toBe("approved");

    // reporting the commit: the field starts EMPTY even though a suggestion exists
    controller.startCommit(only().id);
    expect(controller.getState().commitFlow).toMatchObject({ input: "", step: "enter" });
    await controller.confirmCommit(); // nothing reviewed yet: must not send anything
    expect(harness.calls.applied).toBe(0);

    controller.setCommitInput("abc123");
    controller.reviewCommit();
    expect(controller.getState().commitFlow).toMatchObject({ step: "enter", check: { ok: false, reason: "not_full_sha" } });
    await controller.confirmCommit();
    expect(harness.calls.applied).toBe(0);

    controller.setCommitInput(BASE_SHA);
    controller.reviewCommit();
    expect(controller.getState().commitFlow?.check).toEqual({ ok: false, reason: "same_as_base" });

    controller.useSuggestion(); // fills the field from the suggestion; still not sent, still needs review + confirmation
    expect(controller.getState().commitFlow).toMatchObject({ input: FIX_SHA, step: "enter" });
    await controller.confirmCommit();
    expect(harness.calls.applied).toBe(0);

    controller.reviewCommit();
    const flow = controller.getState().commitFlow!;
    expect(flow.step).toBe("confirm");
    expect(flow.check).toMatchObject({ ok: true, commitSha: FIX_SHA, branch: "main", isSuggestion: true, analysis: { scanId: FIX_SCAN } });
    expect(harness.calls.applied).toBe(0); // reviewing is not confirming

    await controller.confirmCommit();
    await settle();
    expect(harness.calls.applied).toBe(1);
    expect(harness.sent.find((s) => s.action === "applied")?.commitSha).toBe(FIX_SHA);
    expect(controller.getState().commitFlow).toBeNull();
    expect(only().state).toBe("APPLIED");
    expect(only().reportedCommitSha).toBe(FIX_SHA);
    expect(phaseOf(only())).toBe("applied"); // reported, NOT verified

    await controller.verify(only().id);
    await settle();
    expect(only().state).toBe("VERIFIED");
    expect(only().verification).toMatchObject({ statement: "exact_commit_rescan_clean", verifiedCommitSha: FIX_SHA, verifiedAnalysis: { scanId: FIX_SCAN, branch: "main" } });
    expect(phaseOf(only())).toBe("verified");
    expect(controller.getState().error).toBeNull();
  });

  it("a commit SequrAI has not analysed is never presented as a verified correction", async () => {
    const { controller, settle, only } = await setup();
    await controller.generate(PRIORITY);
    await settle();
    await controller.approve(only().id);
    controller.startCommit(only().id);
    controller.setCommitInput(UNSCANNED_SHA);
    controller.reviewCommit();
    expect(controller.getState().commitFlow?.check).toMatchObject({ ok: true, analysis: null, branch: null }); // the dialog warns about it
    await controller.confirmCommit();
    await controller.verify(only().id);
    await settle();
    expect(phaseOf(only())).not.toBe("verified");
    expect(["not_verified", "applied"]).toContain(phaseOf(only()));
    expect(only().verification?.statement ?? "not_verified").toBe("not_verified");
  });

  it("verify outside APPLIED is refused with a stable error and the persisted state is re-read", async () => {
    const { controller, settle, only } = await setup();
    await controller.generate(PRIORITY);
    await settle();
    await controller.verify(only().id);
    expect(controller.getState().error).toEqual({ key: "invalid_state", fixId: only().id });
    expect(only().state).toBe("READY");
  });

  it("generating again reuses the open proposal and never duplicates it", async () => {
    const { controller, settle, tables } = await setup();
    await controller.generate(PRIORITY);
    await settle();
    await controller.generate(PRIORITY);
    await settle();
    expect(controller.getState().notice).toBe("reused");
    expect(tables.safe_fix_records).toHaveLength(1);
    expect(controller.getState().data.fixes).toHaveLength(1);
  });

  it("the displayed state is always the persisted one (changed behind the panel's back, a refresh adopts it)", async () => {
    const { controller, tables, only, settle } = await setup();
    await controller.generate(PRIORITY);
    await settle();
    tables.safe_fix_records![0].lifecycle_state = "APPROVED";
    tables.safe_fix_records![0].updated_at = "2026-03-06T00:00:00.000Z";
    await controller.refresh();
    expect(only().state).toBe("APPROVED");
  });

  it("another organization sees nothing of this project's corrections", async () => {
    const { controller, admin, settle } = await setup();
    await controller.generate(PRIORITY);
    await settle();
    const other = await loadAssistedFixPanelData(admin, { organizationId: "org-z", projectId: PROJECT });
    expect(other.fixes).toEqual([]);
    expect(other.suggestion).toBeNull();
    expect(other.knownAnalyses).toEqual([]);
  });
});

describe("controller error handling (stub API)", () => {
  const data = { projectId: PROJECT, fixes: [], suggestion: null, knownAnalyses: [] };
  const stub = (over: Partial<PanelApi>): PanelApi => ({
    list: async () => ({ ok: true, status: 200, body: { safeFixes: [] } }),
    generate: async () => ({ ok: true, status: 200, body: { result: { status: "no_blockers" } } }),
    approve: async () => ({ ok: false, status: 404, code: "Not found" }),
    applied: async () => ({ ok: false, status: 409, code: "proposal_commit_locked" }),
    verify: async () => ({ ok: false, status: 503, code: "proposal_commit_unsupported" }),
    reopen: async () => ({ ok: false, status: 409, code: "open_fix_exists" }),
    ...over,
  });

  it("maps every failure to a key and leaves the panel usable", async () => {
    const controller = createAssistedFixController({ api: stub({}), initial: data });
    await controller.approve("x");
    expect(controller.getState().error?.key).toBe("not_found");
    await controller.verify("x");
    expect(controller.getState().error?.key).toBe("unsupported");
    await controller.reopen("x");
    expect(controller.getState().error?.key).toBe("open_fix_exists");
    expect(controller.getState().busy).toBeNull();
  });

  it("no blockers and in_flight are explicit, not silent", async () => {
    const c1 = createAssistedFixController({ api: stub({}), initial: data });
    await c1.generate();
    expect(c1.getState().notice).toBe("no_blockers");
    const c2 = createAssistedFixController({
      api: stub({ generate: async () => ({ ok: true, status: 409, body: { result: { status: "in_flight", record: { id: "r1" }, reason: "different_base_analysis" } } }) }),
      initial: data,
    });
    await c2.generate(PRIORITY);
    expect(c2.getState().error).toEqual({ key: "in_flight", fixId: "r1" });
  });
});
