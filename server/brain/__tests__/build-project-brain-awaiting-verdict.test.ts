import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildProjectBrain } from "../build-project-brain";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OLD_SCAN = "22222222-2222-4222-8222-222222222221";
const NEW_SCAN = "44444444-4444-4444-8444-444444444444";
const RUNNING_SCAN = "55555555-5555-4555-8555-555555555555";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function brain(over: { newerCompletedAgoMs?: number; newerStatus?: string; verdictScanId?: string; running?: { status: string; branch: string | null } }) {
  const verdict = buildVerdictFixture({
    projectId: PROJECT, repositoryId: PROJECT, scanId: over.verdictScanId ?? OLD_SCAN, branch: "main",
    status: "ready_to_ship", confidence: "high", score: 95, blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0,
    topPriorities: [] as never,
  } as never);
  const scans = [
    { id: OLD_SCAN, project_id: PROJECT, repository_id: PROJECT, branch: "main", status: "completed", completed_at: ago(3_600_000), security_score: 90 },
    ...(over.newerCompletedAgoMs != null
      ? [{ id: NEW_SCAN, project_id: PROJECT, repository_id: PROJECT, branch: "main", status: over.newerStatus ?? "completed", completed_at: over.newerStatus && over.newerStatus !== "completed" ? null : ago(over.newerCompletedAgoMs), security_score: 80 }]
      : []),
    ...(over.running
      ? [{ id: RUNNING_SCAN, organization_id: ORG, project_id: PROJECT, repository_id: PROJECT, branch: over.running.branch, status: over.running.status, completed_at: null, commit_sha: "d".repeat(40), created_at: ago(5_000) }]
      : []),
  ];
  const tables = {
    projects: [{ id: PROJECT, organization_id: ORG, name: "p", github_repo: "o/p", github_default_branch: "main", security_score: 90, webhook_enabled: true }],
    repository_scan_state: [{ repository_id: PROJECT, organization_id: ORG, current_verdict_id: "33333333-3333-4333-8333-333333330001" }],
    repository_health: [], ai_priorities: [], ai_reports: [], repository_activity: [], security_timeline: [],
    production_verdicts: [verdictRow(PROJECT, verdict, "33333333-3333-4333-8333-333333330001", ORG)],
    scans,
  } as unknown as FakeTables;
  return buildProjectBrain(createFakeAdmin(tables) as never, PROJECT);
}

describe("buildProjectBrain never exposes an older verdict as current while a newer scan awaits its own", () => {
  it("newer completed scan without a verdict -> no current verdict, not production-ready", async () => {
    const snapshot = await brain({ newerCompletedAgoMs: 10_000 });
    expect(snapshot?.currentVerdict).toBeNull();
    expect(snapshot?.productionReady.readyForProduction).toBe(false);
    expect(snapshot?.productionReady.overall).toBeNull();
  });

  it("verdict already belongs to the latest scan -> exposed as before", async () => {
    const snapshot = await brain({ newerCompletedAgoMs: 10_000, verdictScanId: NEW_SCAN });
    expect(snapshot?.currentVerdict?.scanId).toBe(NEW_SCAN);
  });

  it("window elapsed or newer scan failed -> the persisted verdict is still reported (no endless withholding)", async () => {
    expect((await brain({ newerCompletedAgoMs: 600_000 }))?.currentVerdict?.scanId).toBe(OLD_SCAN);
    expect((await brain({ newerCompletedAgoMs: 10_000, newerStatus: "failed" }))?.currentVerdict?.scanId).toBe(OLD_SCAN);
  });

  it("no newer scan -> unchanged", async () => {
    expect((await brain({}))?.currentVerdict?.scanId).toBe(OLD_SCAN);
  });

  it("no review running -> the verdict is current", async () => {
    const snapshot = await brain({});
    expect(snapshot).toMatchObject({ verdictState: "current", reviewInProgress: null });
    expect(snapshot?.productionReady.readyForProduction).toBeDefined();
  });
});

describe("buildProjectBrain during a running scan: the previous verdict is HISTORY, not an approval of the version being analyzed", () => {
  it.each(["queued", "fetching_repository", "scanning", "calculating_score"])(
    "scan %s on the default branch -> historical, readiness withheld, the analyzed version identified",
    async (status) => {
      const snapshot = await brain({ running: { status, branch: "main" } });
      expect(snapshot?.verdictState).toBe("historical_review_in_progress");
      expect(snapshot?.reviewInProgress).toEqual({ scanId: RUNNING_SCAN, commitSha: "d".repeat(40) });
      expect(snapshot?.currentVerdict?.scanId).toBe(OLD_SCAN); // kept for context only
      expect(snapshot?.productionReady.readyForProduction).toBe(false);
      expect(snapshot?.productionReady.overall).toBeNull();
    }
  );

  it("a branchless scan counts as the default branch; a feature-branch scan does not make the verdict historical", async () => {
    expect((await brain({ running: { status: "scanning", branch: null } }))?.verdictState).toBe("historical_review_in_progress");
    expect((await brain({ running: { status: "scanning", branch: "feature/x" } }))?.verdictState).toBe("current");
  });

  it("failed / cancelled scans are terminal: the verdict stays current", async () => {
    for (const status of ["failed", "cancelled"]) {
      expect((await brain({ running: { status, branch: "main" } }))?.verdictState).toBe("current");
    }
  });

  it("a newer scan awaiting its verdict -> pending_verdict with no verdict exposed", async () => {
    const snapshot = await brain({ newerCompletedAgoMs: 10_000 });
    expect(snapshot).toMatchObject({ verdictState: "pending_verdict", currentVerdict: null });
  });
});
