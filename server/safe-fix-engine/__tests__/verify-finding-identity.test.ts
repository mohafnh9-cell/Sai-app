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
import { verifySafeFix } from "../verify";

// Pass 4 CRIT-007: a fix is VERIFIED only when the exact target finding(s) are
// absent from a complete, valid rescan of the same project and repository.
// Score, blocker/finding counts and titles can never be enough.

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "99999999-9999-4999-8999-999999999999";
const BASE_SCAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESCAN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SAFE_FIX = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRIORITY = "priority-1";

type FindingSeed = { id: string; fingerprint: string; rule: string; path: string; title?: string };

const F1: FindingSeed = { id: "f1", fingerprint: "fp-1", rule: "authz.ownership", path: "app/api/orders/route.ts", title: "Missing ownership check" };
const F2: FindingSeed = { id: "f2", fingerprint: "fp-2", rule: "authz.ownership", path: "app/api/users/route.ts", title: "Missing ownership check" };
const F3: FindingSeed = { id: "f3", fingerprint: "fp-3", rule: "injection.sql", path: "lib/db.ts", title: "SQL built from input" };

function findingRow(scanId: string, f: FindingSeed, idSuffix = "") {
  return {
    id: `${f.id}${idSuffix}`,
    scan_id: scanId,
    project_id: PROJECT,
    fingerprint: f.fingerprint,
    rule_id: f.rule,
    file_path: f.path,
    title: f.title ?? f.rule,
    metadata: null,
  };
}

function targetOf(f: FindingSeed) {
  return {
    findingId: f.id,
    source: "native" as const,
    matchKeys: matchKeysForNativeFinding({ fingerprint: f.fingerprint, rule_id: f.rule, file_path: f.path, title: f.title ?? f.rule, metadata: null }),
  };
}

type World = {
  targets?: unknown;
  targetFindings?: FindingSeed[];
  rescanFindings?: FindingSeed[];
  rescan?: Partial<Record<string, unknown>> | null;
  verdictOverrides?: Parameters<typeof buildVerdictFixture>[0];
  engines?: "complete" | "incomplete";
  baselineScore?: number;
  baselineBlockers?: number;
  rescanVerdict?: boolean;
  omitStoredTargets?: boolean;
  analysisRunId?: string | null;
};

function build(world: World = {}) {
  const baselineFindings = [F1, F2, F3];
  const baseVerdict = buildVerdictFixture({
    projectId: PROJECT,
    repositoryId: PROJECT,
    scanId: BASE_SCAN,
    commitSha: "commit-0",
    status: "not_ready",
    score: world.baselineScore ?? 50,
    blockersCount: world.baselineBlockers ?? 3,
    generatedAt: "2026-03-01T00:00:00.000Z",
    topPriorities: [
      {
        id: PRIORITY,
        title: "Missing ownership check",
        rank: 1,
        severity: "high",
        category: "authorization",
        reason: "Missing ownership check.",
        confidence: "high",
        estimatedMinutes: 10,
        estimatedTimeLabel: "10 minutes",
        projectedScoreImpact: 10,
        recommendedAction: "Add an ownership check before returning the resource.",
        findingIds: (world.targetFindings ?? [F1]).map((f) => f.id),
        affectedFiles: [],
      },
    ],
  });

  const rescanVerdict = buildVerdictFixture({
    projectId: PROJECT,
    repositoryId: PROJECT,
    scanId: RESCAN,
    commitSha: "commit-1",
    status: "almost_ready",
    score: 92,
    blockersCount: 1,
    topPriorities: [],
    generatedAt: "2026-03-05T00:00:00.000Z",
    ...world.verdictOverrides,
  });

  const rescanRow =
    world.rescan === null
      ? null
      : {
          id: RESCAN,
          status: "completed",
          created_at: "2026-03-05T00:00:00.000Z",
          commit_sha: "commit-1",
          branch: "main",
          project_id: PROJECT,
          repository_id: PROJECT,
          organization_id: ORG,
          metrics: { rulesRun: 47, ruleFailures: 0 },
          omissions: [],
          ...world.rescan,
        };

  const targetFindings = world.targetFindings ?? [F1];
  const tables: FakeTables = {
    scans: [
      {
        id: BASE_SCAN,
        status: "completed",
        created_at: "2026-03-01T00:00:00.000Z",
        commit_sha: "commit-0",
        branch: "main",
        project_id: PROJECT,
        repository_id: PROJECT,
        organization_id: ORG,
        metrics: {},
        omissions: [],
      },
      ...(rescanRow ? [rescanRow] : []),
    ],
    scan_findings: [
      ...baselineFindings.map((f) => findingRow(BASE_SCAN, f)),
      ...(world.rescanFindings ?? [F2, F3]).map((f) => findingRow(RESCAN, f, "-r")),
    ],
    external_engine_findings: [],
    security_jobs: ["opengrep", "trivy", "crypto"].map((engine, index) => ({
      id: `job-${index}`,
      scan_id: RESCAN,
      organization_id: ORG,
      engine,
      status: world.engines === "incomplete" && engine === "trivy" ? "RUNNING" : "COMPLETED",
    })),
    production_verdicts: [
      verdictRow(PROJECT, baseVerdict, "d0000000-0000-4000-8000-000000000001", ORG),
      ...(world.rescanVerdict === false
        ? []
        : [verdictRow(PROJECT, rescanVerdict, "d0000000-0000-4000-8000-000000000002", ORG)]),
    ],
    repository_scan_state: [
      {
        repository_id: PROJECT,
        organization_id: ORG,
        current_verdict_id: "d0000000-0000-4000-8000-000000000002",
        last_scan_id: RESCAN,
        active_scan_id: null,
      },
    ],
    safe_fix_records: [
      {
        id: SAFE_FIX,
        organization_id: ORG,
        project_id: PROJECT,
        recommendation_id: PRIORITY,
        review_id: BASE_SCAN,
        verdict_id: null,
        lifecycle_state: "APPLIED",
        confidence_band: "HIGH",
        confidence_score: 80,
        document: { executiveSummary: "fix" },
        pr_draft: {},
        baseline_snapshot: {
          score: world.baselineScore ?? 50,
          blockersCount: world.baselineBlockers ?? 3,
          priorityTitle: "Missing ownership check",
          ...(world.omitStoredTargets
            ? {}
            : { targetFindings: (world.targets ?? targetFindings.map(targetOf)) as unknown }),
        },
        created_at: "2026-03-01T01:00:00.000Z",
        updated_at: "2026-03-01T01:00:00.000Z",
      },
    ],
    safe_fix_lifecycle_events: [],
    safe_fix_verifications: [],
  };
  return { tables, admin: createFakeAdmin(tables) };
}

async function run(world: World = {}) {
  const { tables, admin } = build(world);
  const result = await verifySafeFix(admin as never, {
    safeFixId: SAFE_FIX,
    organizationId: ORG,
    projectId: PROJECT,
    analysisRunId: world.analysisRunId === undefined ? RESCAN : world.analysisRunId,
    actor: "test",
  });
  const record = tables.safe_fix_records![0];
  const verification = tables.safe_fix_verifications![0];
  return { result, state: record.lifecycle_state as string, verification, tables };
}

const NOT_VERIFIED = (state: string, outcome: string) => {
  expect(state).not.toBe("VERIFIED");
  expect(outcome).not.toBe("passed");
};

describe("CRIT-007 verification never passes on weak evidence", () => {
  it("A: blocker count decreases but the target finding remains -> NOT VERIFIED", async () => {
    const { result, state } = await run({ rescanFindings: [F1, F3], baselineBlockers: 3 });
    NOT_VERIFIED(state, result.outcome);
    expect(result.outcome).toBe("failed");
    expect(result.details.reasons).toContain("target_still_present");
  });

  it("B: title matches a baseline finding but the recorded fingerprint is not that finding's -> NOT VERIFIED", async () => {
    // The record claims fp-bogus for a finding titled "Missing ownership check".
    // fp-bogus is trivially absent from every rescan; it must not verify anything.
    const bogus = [
      {
        findingId: "f1",
        source: "native" as const,
        matchKeys: ["fp:fp-bogus", "ck:not-the-real-key"],
      },
    ];
    const { result, state } = await run({ targets: bogus, rescanFindings: [F2, F3] });
    NOT_VERIFIED(state, result.outcome);
    expect(result.details.reasons).toContain("no_target_identity");
  });

  it("B2: a different finding that merely shares the title does not block or fake verification of the exact target", async () => {
    // F2 has the same title as F1 but is a different finding. Title is not identity:
    // the exact target (F1) is gone, F2 is a separate issue.
    const { result, state } = await run({ rescanFindings: [F2, F3] });
    expect(result.outcome).toBe("passed");
    expect(state).toBe("VERIFIED");
  });

  it("C: score increases but the target finding remains -> NOT VERIFIED", async () => {
    const { result, state } = await run({
      rescanFindings: [F1],
      baselineScore: 30,
      verdictOverrides: { score: 99 },
    });
    NOT_VERIFIED(state, result.outcome);
    expect(result.productionConfidenceImproved).toBe(true);
  });

  it("D: total finding count decreases but the target finding remains -> NOT VERIFIED", async () => {
    const { result, state } = await run({ rescanFindings: [F1] }); // 3 -> 1 findings
    NOT_VERIFIED(state, result.outcome);
  });

  it("E: target disappears but coverage is insufficient -> NOT VERIFIED", async () => {
    const { result, state } = await run({
      verdictOverrides: { status: "insufficient_data", score: null, coverageRatio: 0.02 },
    });
    NOT_VERIFIED(state, result.outcome);
    expect(result.outcome).toBe("partial");
    expect(result.details.reasons).toContain("insufficient_coverage");
    expect(result.issueDisappeared).toBe(true);
  });

  it("F: target disappears but an engine did not complete -> NOT VERIFIED", async () => {
    const { result, state } = await run({
      engines: "incomplete",
      verdictOverrides: { status: "insufficient_data", score: null },
    });
    NOT_VERIFIED(state, result.outcome);
    expect(result.details.reasons).toContain("engine_incomplete");
  });

  it("F2: a native rule failure in the rescan -> NOT VERIFIED", async () => {
    const { result, state } = await run({
      rescan: { metrics: { rulesRun: 45, ruleFailures: 2 } },
      verdictOverrides: { status: "insufficient_data", score: null },
    });
    NOT_VERIFIED(state, result.outcome);
    expect(result.details.reasons).toContain("rule_failures");
  });

  it("F3: an engine failure is not trusted even if the verdict claims a complete status", async () => {
    const { result, state } = await run({ engines: "incomplete" });
    NOT_VERIFIED(state, result.outcome);
    expect(result.details.reasons).toContain("engine_incomplete");
  });

  describe("G: target disappears in a wrong or stale scan -> NOT VERIFIED", () => {
    it("the baseline scan itself is not a rescan", async () => {
      const { result, state } = await run({ analysisRunId: BASE_SCAN });
      NOT_VERIFIED(state, result.outcome);
      expect(result.details.reasons).toContain("verification_scan_is_baseline");
    });

    it("a scan older than the baseline is stale", async () => {
      const { result, state } = await run({ rescan: { created_at: "2026-02-01T00:00:00.000Z" } });
      NOT_VERIFIED(state, result.outcome);
      expect(result.details.reasons).toContain("verification_scan_not_newer");
    });

    it("a scan of the same commit cannot have fixed anything", async () => {
      const { result, state } = await run({ rescan: { commit_sha: "commit-0" } });
      NOT_VERIFIED(state, result.outcome);
      expect(result.details.reasons).toContain("same_commit");
    });

    it("a scan that did not complete", async () => {
      const { result, state } = await run({ rescan: { status: "scanning" } });
      NOT_VERIFIED(state, result.outcome);
      expect(result.details.reasons).toContain("scan_not_completed");
    });

    it("a scan of a different branch", async () => {
      const { result, state } = await run({ rescan: { branch: "feature/x" } });
      NOT_VERIFIED(state, result.outcome);
      expect(result.details.reasons).toContain("branch_mismatch");
    });

    it("a rescan whose verdict is missing", async () => {
      const { result, state } = await run({ rescanVerdict: false });
      NOT_VERIFIED(state, result.outcome);
      expect(result.details.reasons).toContain("verdict_missing");
    });
  });

  it("H: the target fingerprint disappears in a complete valid rescan -> VERIFIED", async () => {
    const { result, state, verification } = await run({ rescanFindings: [F2, F3] });
    expect(result.outcome).toBe("passed");
    expect(state).toBe("VERIFIED");
    expect(verification.outcome).toBe("passed");
    expect(result.issueDisappeared).toBe(true);
    expect(verification.details).toMatchObject({
      baselineScanId: BASE_SCAN,
      verificationScanId: RESCAN,
      targetFindingIds: ["f1"],
    });
  });

  it("H2: a finding that only moved to another line is still present -> NOT VERIFIED", async () => {
    // Same rule, file and rule material; different line => different fingerprint,
    // same correlation key. It is the same finding.
    const moved = { ...F1, fingerprint: "fp-1-moved-line" };
    const { result, state } = await run({ rescanFindings: [moved, F3] });
    NOT_VERIFIED(state, result.outcome);
    expect(result.details.reasons).toContain("target_still_present");
  });

  it("I: multiple targets, one remains -> NOT VERIFIED", async () => {
    const { result, state } = await run({
      targetFindings: [F1, F3],
      rescanFindings: [F3, F2],
    });
    NOT_VERIFIED(state, result.outcome);
    expect(result.outcome).toBe("failed");
  });

  it("J: multiple targets, all disappear in a valid rescan -> VERIFIED", async () => {
    const { result, state } = await run({
      targetFindings: [F1, F3],
      rescanFindings: [F2],
    });
    expect(result.outcome).toBe("passed");
    expect(state).toBe("VERIFIED");
  });

  it("K: a rescan that belongs to a different project -> NOT VERIFIED", async () => {
    const { result, state } = await run({ rescan: { project_id: OTHER_PROJECT } });
    NOT_VERIFIED(state, result.outcome);
    expect(result.details.reasons).toContain("wrong_project");
  });

  it("L: a rescan that belongs to a different repository -> NOT VERIFIED", async () => {
    const { result, state } = await run({ rescan: { repository_id: OTHER_PROJECT } });
    NOT_VERIFIED(state, result.outcome);
    expect(result.details.reasons).toContain("wrong_repository");
  });

  it("M: an unknown verification scan id -> NOT VERIFIED", async () => {
    const { result, state } = await run({ analysisRunId: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
    NOT_VERIFIED(state, result.outcome);
    expect(result.details.reasons).toContain("verification_scan_missing");
  });

  it("M2: a rescan owned by another organization -> NOT VERIFIED", async () => {
    const { result, state } = await run({ rescan: { organization_id: "org-b" } });
    NOT_VERIFIED(state, result.outcome);
  });

  it("legacy record without stored targets re-resolves them from the baseline scan (and can verify)", async () => {
    const { result, state } = await run({ omitStoredTargets: true, rescanFindings: [F2, F3] });
    expect(result.outcome).toBe("passed");
    expect(state).toBe("VERIFIED");
  });

  it("legacy record whose baseline identity cannot be resolved fails closed", async () => {
    const { result, state } = await run({
      omitStoredTargets: true,
      targetFindings: [{ ...F1, id: "does-not-exist" }],
      rescanFindings: [F2, F3],
    });
    NOT_VERIFIED(state, result.outcome);
    expect(result.details.reasons).toContain("no_target_identity");
  });

  it("with no analysisRunId it verifies against the latest evaluation, never the baseline scan", async () => {
    const { result, state } = await run({ analysisRunId: null, rescanFindings: [F2, F3] });
    expect(result.outcome).toBe("passed");
    expect(state).toBe("VERIFIED");
  });
});
