import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/observability/metrics", () => ({ incrementMetricCounter: vi.fn() }));
vi.mock("@/server/observability/operation-timing", () => ({
  withOperationTiming: async (_name: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../memory-bridge", () => ({ appendSafeFixMemoryEvent: vi.fn(async () => undefined) }));
vi.mock("@/server/continuous-protection/protection-context", () => ({
  loadProtectionContext: vi.fn(async () => null),
}));

import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
import { matchKeysForNativeFinding } from "../finding-identity";
import { setSafeFixProposalCommit } from "../proposal-commit";
import { approveSafeFix, markSafeFixApplied, verifySafeFix } from "../verify";
import { decideFindingVerification, type VerificationEvidence } from "../verification-rules";

// A proposal bound to a commit is verified against the completed scan of EXACTLY that commit.
// A later / different commit is never evidence about it, even when the finding is gone.

const ORG = "org-a";
const OTHER_ORG = "org-z";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "99999999-9999-4999-8999-999999999999";
const BASE_SCAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROPOSAL_SCAN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LATER_SCAN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SAFE_FIX = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BASE_SHA = "a".repeat(40);
const PROPOSAL_SHA = "b".repeat(40);
const LATER_SHA = "c".repeat(40);
const PRIORITY = "priority-1";

const F1 = { id: "f1", fingerprint: "fp-1", rule: "authz.ownership", path: "app/api/orders/route.ts", title: "Missing ownership check" };
const F2 = { id: "f2", fingerprint: "fp-2", rule: "injection.sql", path: "lib/db.ts", title: "SQL built from input" };

const finding = (scanId: string, f: typeof F1, suffix = "") => ({
  id: `${f.id}${suffix}`, scan_id: scanId, project_id: PROJECT, fingerprint: f.fingerprint, rule_id: f.rule, file_path: f.path, title: f.title, metadata: null,
});
const target = (f: typeof F1) => ({
  findingId: f.id, source: "native" as const,
  matchKeys: matchKeysForNativeFinding({ fingerprint: f.fingerprint, rule_id: f.rule, file_path: f.path, title: f.title, metadata: null }),
});

const scanRow = (id: string, sha: string, over: Record<string, unknown> = {}) => ({
  id, status: "completed", created_at: "2026-03-05T00:00:00.000Z", completed_at: "2026-03-05T00:01:00.000Z", commit_sha: sha, branch: "main",
  project_id: PROJECT, repository_id: PROJECT, organization_id: ORG, metrics: { rulesRun: 47, ruleFailures: 0 }, omissions: [], ...over,
});

type World = {
  proposalSha?: string | null | undefined; // undefined = column absent (record from before migration 067)
  state?: string;
  rescans?: Array<Record<string, unknown>>; // completed scans other than the baseline
  rescanFindingsByScan?: Record<string, Array<typeof F1>>;
  enginesIncompleteFor?: string;
};

function build(world: World) {
  const rescans = world.rescans ?? [scanRow(PROPOSAL_SCAN, PROPOSAL_SHA)];
  const baseVerdict = buildVerdictFixture({
    projectId: PROJECT, repositoryId: PROJECT, scanId: BASE_SCAN, commitSha: BASE_SHA, status: "not_ready", score: 50, blockersCount: 2,
    generatedAt: "2026-03-01T00:00:00.000Z",
    topPriorities: [{ id: PRIORITY, title: "Missing ownership check", rank: 1, severity: "high", category: "authorization", reason: "r", confidence: "high",
      estimatedMinutes: 10, estimatedTimeLabel: "10 minutes", projectedScoreImpact: 10, recommendedAction: "a", findingIds: ["f1"], affectedFiles: [] }],
  });
  const verdicts = [verdictRow(PROJECT, baseVerdict, "d0000000-0000-4000-8000-000000000001", ORG)];
  rescans.forEach((s, i) => {
    verdicts.push(verdictRow(PROJECT, buildVerdictFixture({
      projectId: PROJECT, repositoryId: PROJECT, scanId: s.id as string, commitSha: s.commit_sha as string, status: "almost_ready", score: 92,
      blockersCount: 1, topPriorities: [], generatedAt: `2026-03-0${5 + i}T00:00:00.000Z`,
    }), `d0000000-0000-4000-8000-00000000001${i}`, ORG));
  });
  const proposal = world.proposalSha === undefined ? {} : { proposal_commit_sha: world.proposalSha };
  const tables = {
    scans: [scanRow(BASE_SCAN, BASE_SHA, { created_at: "2026-03-01T00:00:00.000Z", completed_at: "2026-03-01T00:01:00.000Z", metrics: {} }), ...rescans],
    scan_findings: [
      finding(BASE_SCAN, F1), finding(BASE_SCAN, F2),
      ...rescans.flatMap((s) => (world.rescanFindingsByScan?.[s.id as string] ?? [F2]).map((f) => finding(s.id as string, f, `-${s.id}`))),
    ],
    external_engine_findings: [],
    security_jobs: rescans.flatMap((s) => ["opengrep", "trivy", "crypto"].map((engine, i) => ({
      id: `job-${s.id}-${i}`, scan_id: s.id, organization_id: ORG, engine,
      status: world.enginesIncompleteFor === s.id && engine === "trivy" ? "RUNNING" : "COMPLETED",
    }))),
    production_verdicts: verdicts,
    repository_scan_state: [{ repository_id: PROJECT, organization_id: ORG, current_verdict_id: "d0000000-0000-4000-8000-000000000010", last_scan_id: rescans.at(-1)?.id, active_scan_id: null }],
    safe_fix_records: [{
      id: SAFE_FIX, organization_id: ORG, project_id: PROJECT, recommendation_id: PRIORITY, review_id: BASE_SCAN, verdict_id: null,
      lifecycle_state: world.state ?? "APPLIED", confidence_band: "HIGH", confidence_score: 80, document: { executiveSummary: "fix" }, pr_draft: {},
      baseline_snapshot: { score: 50, blockersCount: 2, priorityTitle: "Missing ownership check", targetFindings: [target(F1)] },
      created_at: "2026-03-01T01:00:00.000Z", updated_at: "2026-03-01T01:00:00.000Z", ...proposal,
    }],
    safe_fix_lifecycle_events: [],
    safe_fix_verifications: [],
  } as unknown as FakeTables;
  return { tables, admin: createFakeAdmin(tables) as never };
}

const verify = (admin: never, analysisRunId: string | null = null) =>
  verifySafeFix(admin, { safeFixId: SAFE_FIX, organizationId: ORG, projectId: PROJECT, analysisRunId, actor: "t" });

describe("proposal bound to a commit: the rescan must be exactly that commit", () => {
  it("exact SHA, complete valid rescan, target gone -> VERIFIED, bound to the proposal commit", async () => {
    const { admin, tables } = build({ proposalSha: PROPOSAL_SHA });
    const result = await verify(admin);
    expect(result.outcome).toBe("passed");
    expect(result.binding).toBe("exact_proposal_commit");
    expect(tables.safe_fix_records![0].lifecycle_state).toBe("VERIFIED");
    expect(tables.safe_fix_verifications![0].details).toMatchObject({
      binding: "exact_proposal_commit", baseCommitSha: BASE_SHA, proposalCommitSha: PROPOSAL_SHA, verifiedCommitSha: PROPOSAL_SHA, verificationScanId: PROPOSAL_SCAN,
    });
  });

  it("a LATER commit that no longer contains the finding is not accepted for this proposal (only that scan exists)", async () => {
    const { admin, tables } = build({ proposalSha: PROPOSAL_SHA, rescans: [scanRow(LATER_SCAN, LATER_SHA)] });
    const result = await verify(admin);
    expect(result.outcome).not.toBe("passed");
    expect(result.details.reasons).toContain("verification_scan_missing");
    expect(tables.safe_fix_records![0].lifecycle_state).not.toBe("VERIFIED");
  });

  it("the latest scan / a named run of another commit is ignored: the proposal's own commit scan decides", async () => {
    const { admin } = build({
      proposalSha: PROPOSAL_SHA,
      rescans: [scanRow(PROPOSAL_SCAN, PROPOSAL_SHA), scanRow(LATER_SCAN, LATER_SHA, { created_at: "2026-03-09T00:00:00.000Z", completed_at: "2026-03-09T00:01:00.000Z" })],
      rescanFindingsByScan: { [PROPOSAL_SCAN]: [F1, F2], [LATER_SCAN]: [F2] }, // fixed in the LATER commit, still present in the proposal's
    });
    const result = await verify(admin, LATER_SCAN);
    expect(result.outcome).toBe("failed");
    expect(result.details.reasons).toContain("target_still_present");
  });

  it.each([
    ["another organization", { organization_id: OTHER_ORG }],
    ["another project", { project_id: OTHER_PROJECT }],
    ["another branch", { branch: "feature/x" }],
  ])("the proposal-commit scan belongs to %s -> not used, NOT VERIFIED", async (_label, over) => {
    const { admin, tables } = build({ proposalSha: PROPOSAL_SHA, rescans: [scanRow(PROPOSAL_SCAN, PROPOSAL_SHA, over)] });
    const result = await verify(admin);
    expect(result.outcome).not.toBe("passed");
    expect(tables.safe_fix_records![0].lifecycle_state).not.toBe("VERIFIED");
  });

  it("another repository (same project/org) -> rejected by identity rules", async () => {
    const { admin } = build({ proposalSha: PROPOSAL_SHA, rescans: [scanRow(PROPOSAL_SCAN, PROPOSAL_SHA, { repository_id: OTHER_PROJECT })] });
    const result = await verify(admin);
    expect(result.outcome).not.toBe("passed");
    expect(result.details.reasons).toContain("wrong_repository");
  });

  it("incomplete scan (not completed) -> NOT VERIFIED", async () => {
    const { admin } = build({ proposalSha: PROPOSAL_SHA, rescans: [scanRow(PROPOSAL_SCAN, PROPOSAL_SHA, { status: "running" })] });
    const result = await verify(admin);
    expect(result.outcome).not.toBe("passed");
    expect(result.details.reasons).toContain("verification_scan_missing");
  });

  it("insufficient evidence (an engine still running on the proposal's scan) -> NOT VERIFIED", async () => {
    const { admin, tables } = build({ proposalSha: PROPOSAL_SHA, enginesIncompleteFor: PROPOSAL_SCAN });
    const result = await verify(admin);
    expect(result.outcome).not.toBe("passed");
    expect(tables.safe_fix_records![0].lifecycle_state).not.toBe("VERIFIED");
  });

  it("the proposal changes WHILE a verification runs -> the verification cannot approve the new content", async () => {
    const { admin: real, tables } = build({ proposalSha: PROPOSAL_SHA });
    let moved = false;
    const admin = new Proxy(real as object, {
      get(target, prop, receiver) {
        if (prop === "from") {
          return (name: string) => {
            if (name === "scan_findings" && !moved) {
              moved = true;
              tables.safe_fix_records![0].proposal_commit_sha = LATER_SHA;
            }
            return (target as { from: (n: string) => unknown }).from(name);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as never;
    const result = await verify(admin);
    expect(result.outcome).toBe("partial");
    expect(result.details.reasons).toContain("proposal_changed_during_verification");
    expect(tables.safe_fix_records![0].lifecycle_state).not.toBe("VERIFIED");
  });
});

describe("pure rule: proposal commit mismatch", () => {
  const base: VerificationEvidence = {
    projectId: PROJECT, organizationId: ORG,
    baselineScan: { id: BASE_SCAN, status: "completed", createdAt: "2026-03-01T00:00:00.000Z", commitSha: BASE_SHA, branch: "main", projectId: PROJECT, repositoryId: PROJECT, organizationId: ORG },
    verificationScan: { id: LATER_SCAN, status: "completed", createdAt: "2026-03-09T00:00:00.000Z", commitSha: LATER_SHA, branch: "main", projectId: PROJECT, repositoryId: PROJECT, organizationId: ORG },
    verdict: null, externalEngineIncomplete: false, nativeRuleCoverageIncomplete: false, targets: [target(F1)], targetsFullyResolved: true, rescanKeys: new Set<string>(),
  };
  it("a scan of another commit is rejected for a bound proposal even though the target is absent", () => {
    const decision = decideFindingVerification({ ...base, proposalCommitSha: PROPOSAL_SHA });
    expect(decision.reasons).toContain("proposal_commit_mismatch");
    expect(decision.outcome).toBe("partial");
  });
  it("without a proposal commit the commit-equality rule is not applied (documentary flow)", () => {
    expect(decideFindingVerification({ ...base, proposalCommitSha: null }).reasons).not.toContain("proposal_commit_mismatch");
  });
  it("comparison is case-insensitive on the full SHA", () => {
    const rescan = { ...base.verificationScan!, commitSha: PROPOSAL_SHA.toUpperCase() };
    expect(decideFindingVerification({ ...base, verificationScan: rescan, proposalCommitSha: PROPOSAL_SHA }).reasons).not.toContain("proposal_commit_mismatch");
  });
});

describe("records without a proposal SHA (before migration 067 / documentary proposals)", () => {
  it("keep the assisted flow, explicitly reported as unbound -- never as a verified automatic patch", async () => {
    for (const proposalSha of [undefined, null]) {
      const { admin } = build({ proposalSha, rescans: [scanRow(LATER_SCAN, LATER_SHA)] });
      const result = await verify(admin, LATER_SCAN);
      expect(result.outcome).toBe("passed");
      expect(result.binding).toBe("assisted_unbound");
    }
  });
});

describe("changing the proposal commit invalidates earlier approval/verification", () => {
  const scope = { organizationId: ORG, projectId: PROJECT };

  it("VERIFIED -> reopened to READY with an auditable reason; the new SHA is stored", async () => {
    const { admin, tables } = build({ proposalSha: PROPOSAL_SHA, state: "VERIFIED" });
    const out = await setSafeFixProposalCommit(admin, { safeFixId: SAFE_FIX, scope, commitSha: LATER_SHA, actor: "u" });
    expect(out).toEqual({ changed: true, state: "READY" });
    expect(tables.safe_fix_records![0]).toMatchObject({ lifecycle_state: "READY", proposal_commit_sha: LATER_SHA });
    expect(String(tables.safe_fix_lifecycle_events![0].reason)).toContain("proposal_commit_changed");
  });

  it("the previous verification cannot approve the new commit: re-verifying it needs ITS scan", async () => {
    const { admin, tables } = build({ proposalSha: PROPOSAL_SHA, state: "VERIFIED" });
    await setSafeFixProposalCommit(admin, { safeFixId: SAFE_FIX, scope, commitSha: LATER_SHA, actor: "u" });
    tables.safe_fix_records![0].lifecycle_state = "APPLIED";
    const result = await verify(admin);
    expect(result.outcome).not.toBe("passed");
    expect(tables.safe_fix_records![0].lifecycle_state).not.toBe("VERIFIED");
  });

  it("APPROVED is reopened too (the approval was for the previous content); PROPOSED/READY keep their state", async () => {
    const approved = build({ proposalSha: PROPOSAL_SHA, state: "APPROVED" });
    expect((await setSafeFixProposalCommit(approved.admin, { safeFixId: SAFE_FIX, scope, commitSha: LATER_SHA, actor: "u" })).state).toBe("READY");
    const ready = build({ proposalSha: null, state: "READY" });
    expect((await setSafeFixProposalCommit(ready.admin, { safeFixId: SAFE_FIX, scope, commitSha: LATER_SHA, actor: "u" })).state).toBe("READY");
  });

  it("setting the same SHA again is a no-op (no event, state kept)", async () => {
    const { admin, tables } = build({ proposalSha: PROPOSAL_SHA, state: "VERIFIED" });
    expect(await setSafeFixProposalCommit(admin, { safeFixId: SAFE_FIX, scope, commitSha: PROPOSAL_SHA.toUpperCase(), actor: "u" })).toEqual({ changed: false, state: "VERIFIED" });
    expect(tables.safe_fix_lifecycle_events).toEqual([]);
  });

  it("locked while applied/verifying; a malformed SHA and the base commit are rejected; foreign scope is not found", async () => {
    for (const state of ["APPLIED", "VERIFYING"]) {
      const { admin } = build({ proposalSha: PROPOSAL_SHA, state });
      await expect(setSafeFixProposalCommit(admin, { safeFixId: SAFE_FIX, scope, commitSha: LATER_SHA, actor: "u" })).rejects.toThrow("proposal_commit_locked");
    }
    const { admin } = build({ proposalSha: null, state: "READY" });
    await expect(setSafeFixProposalCommit(admin, { safeFixId: SAFE_FIX, scope, commitSha: "abc123", actor: "u" })).rejects.toThrow("invalid_commit_sha");
    await expect(setSafeFixProposalCommit(admin, { safeFixId: SAFE_FIX, scope, commitSha: BASE_SHA, actor: "u" })).rejects.toThrow("proposal_commit_is_base_commit");
    await expect(setSafeFixProposalCommit(admin, { safeFixId: SAFE_FIX, scope: { organizationId: OTHER_ORG, projectId: PROJECT }, commitSha: LATER_SHA, actor: "u" })).rejects.toThrow("safe_fix_not_found");
  });

  it("generic transitions cannot reopen VERIFIED/APPROVED without the proposal-change reason", async () => {
    const { transitionSafeFixState } = await import("../lifecycle");
    const { admin } = build({ proposalSha: PROPOSAL_SHA, state: "VERIFIED" });
    await expect(transitionSafeFixState(admin, { safeFixId: SAFE_FIX, organizationId: ORG, projectId: PROJECT, toState: "READY", actor: "u", reason: "because" })).rejects.toThrow("invalid_transition");
  });
});

describe("assisted pilot flow: instructions -> customer's agent commits -> rescan -> verify", () => {
  const scope = { organizationId: ORG, projectId: PROJECT };
  const ids = { safeFixId: SAFE_FIX, organizationId: ORG, projectId: PROJECT, actor: "customer" };

  it("approve -> applied WITH the customer's commit -> rescan of that commit -> VERIFIED, bound to the commit", async () => {
    const { admin, tables } = build({ proposalSha: null, state: "READY" });
    await approveSafeFix(admin, ids);
    expect(await markSafeFixApplied(admin, { ...ids, commitSha: PROPOSAL_SHA })).toEqual({ binding: "exact_proposal_commit" });
    expect(tables.safe_fix_records![0]).toMatchObject({ lifecycle_state: "APPLIED", proposal_commit_sha: PROPOSAL_SHA });
    const result = await verify(admin);
    expect(result).toMatchObject({ outcome: "passed", binding: "exact_proposal_commit" });
    expect(tables.safe_fix_verifications![0].details).toMatchObject({ baseCommitSha: BASE_SHA, verifiedCommitSha: PROPOSAL_SHA });
  });

  it("the customer reports a commit whose rescan is not finished yet (pending) -> NOT VERIFIED; no other scan substitutes", async () => {
    const { admin, tables } = build({
      proposalSha: null, state: "READY",
      rescans: [scanRow(PROPOSAL_SCAN, PROPOSAL_SHA, { status: "running" }), scanRow(LATER_SCAN, LATER_SHA)],
    });
    await approveSafeFix(admin, ids);
    await markSafeFixApplied(admin, { ...ids, commitSha: PROPOSAL_SHA });
    const result = await verify(admin);
    expect(result.outcome).not.toBe("passed");
    expect(tables.safe_fix_records![0].lifecycle_state).not.toBe("VERIFIED");
  });

  it("applied WITHOUT a commit stays documentary: verification is reported assisted_unbound, never an exact-commit proof", async () => {
    const { admin } = build({ proposalSha: null, state: "READY", rescans: [scanRow(LATER_SCAN, LATER_SHA)] });
    await approveSafeFix(admin, ids);
    expect(await markSafeFixApplied(admin, ids)).toEqual({ binding: "assisted_unbound" });
    expect((await verify(admin, LATER_SCAN)).binding).toBe("assisted_unbound");
  });

  it("a commit cannot be recorded on a record that is not APPROVED (no half-applied state)", async () => {
    const { admin, tables } = build({ proposalSha: null, state: "READY" });
    await expect(markSafeFixApplied(admin, { ...ids, commitSha: PROPOSAL_SHA })).rejects.toThrow("invalid_transition");
    expect(tables.safe_fix_records![0]).toMatchObject({ lifecycle_state: "READY" });
    expect(tables.safe_fix_records![0].proposal_commit_sha ?? null).toBeNull();
  });

  it("a first commit on an APPROVED record keeps the approval; a later different commit reopens it", async () => {
    const { admin, tables } = build({ proposalSha: null, state: "APPROVED" });
    expect((await setSafeFixProposalCommit(admin, { safeFixId: SAFE_FIX, scope, commitSha: PROPOSAL_SHA, actor: "u" })).state).toBe("APPROVED");
    expect((await setSafeFixProposalCommit(admin, { safeFixId: SAFE_FIX, scope, commitSha: LATER_SHA, actor: "u" })).state).toBe("READY");
    expect(tables.safe_fix_records![0].proposal_commit_sha).toBe(LATER_SHA);
  });
});
