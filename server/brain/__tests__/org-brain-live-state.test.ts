import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const shared = vi.hoisted(() => ({ cacheAdmin: null as unknown }));
vi.mock("@/server/security-scanner/admin-client", () => ({ createAdminClient: () => shared.cacheAdmin }));

import { getCachedOrgBrain } from "../build-org-brain";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OLD_SCAN = "22222222-2222-4222-8222-222222222221";
const NEW_SCAN = "44444444-4444-4444-8444-444444444444";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** A project whose latest persisted verdict is a genuine READY (high confidence, complete coverage) on `main`. */
function world(scans: Array<Record<string, unknown>> = []) {
  const verdict = buildVerdictFixture({
    projectId: PROJECT, repositoryId: PROJECT, scanId: OLD_SCAN, branch: "main", status: "ready_to_ship", confidence: "high", score: 96,
    blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, topPriorities: [] as never, unevaluatedAreas: [], partiallyEvaluatedAreas: [],
  } as never);
  const tables = {
    projects: [{ id: PROJECT, organization_id: ORG, name: "demo", repository_health: null, github_default_branch: "main" }],
    production_verdicts: [verdictRow(PROJECT, verdict, "33333333-3333-4333-8333-333333330001", ORG)],
    scans,
    ai_priorities: [], repository_activity: [], security_timeline: [],
  } as unknown as FakeTables;
  return { tables, supabase: createFakeAdmin(tables) as never };
}
const running = (status = "scanning", branch: string | null = "main") => ({
  id: NEW_SCAN, organization_id: ORG, project_id: PROJECT, repository_id: PROJECT, branch, status, created_at: ago(5_000), completed_at: null,
});
const completedJustNow = (branch: string | null = "main") => ({
  id: NEW_SCAN, organization_id: ORG, project_id: PROJECT, repository_id: PROJECT, branch, status: "completed", created_at: ago(30_000), completed_at: ago(8_000),
});
const first = async (supabase: never) => (await getCachedOrgBrain(supabase, ORG)).projects[0];

beforeEach(() => {
  shared.cacheAdmin = createFakeAdmin({ org_brain_cache: [] } as unknown as FakeTables);
});

describe("OrgBrain (dashboard + projects) must not present a previous verdict as the current decision", () => {
  it("control: no scan running -> current, affirmative (genuine READY)", async () => {
    const { supabase } = world();
    expect(await first(supabase)).toMatchObject({ verdictState: "current", affirmsDeploy: true, productionReady: 96 });
  });

  it("a review is running on the default branch -> the READY is HISTORICAL: no affirmation, no current score", async () => {
    const { supabase } = world([running()]);
    const summary = await first(supabase);
    expect(summary).toMatchObject({ verdictState: "historical_review_in_progress", affirmsDeploy: false, productionReady: null });
    expect(summary.verdictScanId).toBe(OLD_SCAN); // kept as context
  });

  it.each(["queued", "fetching_repository", "indexing", "scanning", "calculating_score"])("scan status %s counts as running", async (status) => {
    const { supabase } = world([running(status)]);
    expect((await first(supabase)).verdictState).toBe("historical_review_in_progress");
  });

  it("a feature-branch scan does not make the default-branch verdict historical; a branchless scan does", async () => {
    expect((await first(world([running("scanning", "feature/x")]).supabase)).verdictState).toBe("current");
    expect((await first(world([running("scanning", null)]).supabase)).verdictState).toBe("historical_review_in_progress");
  });

  it("a newer scan completed but its verdict is not persisted yet -> pending_verdict, not affirmative", async () => {
    const summary = await first(world([completedJustNow()]).supabase);
    expect(summary).toMatchObject({ verdictState: "pending_verdict", affirmsDeploy: false, productionReady: null });
  });

  it("failed / cancelled scans are terminal: the verdict stays current", async () => {
    for (const status of ["failed", "cancelled"]) {
      expect((await first(world([{ ...running(status) }]).supabase)).verdictState).toBe("current");
    }
  });

  it("the 20 s cache cannot hide a scan that starts after the snapshot was cached", async () => {
    const { tables, supabase } = world();
    expect((await first(supabase)).verdictState).toBe("current"); // populates the cache
    tables.scans!.push(running());
    const second = await first(supabase); // cache hit
    expect(second).toMatchObject({ verdictState: "historical_review_in_progress", affirmsDeploy: false });
  });

  it("the cache cannot keep showing the old verdict as current after a newer scan completed", async () => {
    const { tables, supabase } = world();
    await first(supabase);
    tables.scans!.push(completedJustNow());
    expect((await first(supabase)).verdictState).toBe("pending_verdict");
  });

  it("if the live state cannot be read, nothing is affirmed (unknown is not safe)", async () => {
    const { supabase } = world();
    await first(supabase); // cached
    const broken = { from: () => { throw new Error("db down"); } } as never;
    const summary = (await getCachedOrgBrain(broken, ORG)).projects[0];
    expect(summary.affirmsDeploy).toBe(false);
  });
});
