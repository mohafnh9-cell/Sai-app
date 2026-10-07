import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listAnalysisRunsForProject } from "../list-analysis-runs";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture } from "@/server/mcp/__tests__/verdict-fixture";

const ORG = "org-1";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const area = (key: string) => ({ key, label: key, score: null, status: "not_evaluated", confidence: "low", limitations: "", methodology: "", evidenceCount: 0 });

const scan = (id: string, created: string, score: number) => ({
  id, project_id: PROJECT, organization_id: ORG, status: "completed", commit_sha: `${id}1234567890`, branch: "main",
  created_at: created, completed_at: created, security_score: score,
});
const verdictRow = (scanId: string, verdict: Record<string, unknown> | null, project = PROJECT, org = ORG) => ({
  id: `v-${scanId}`, scan_id: scanId, project_id: project, organization_id: org,
  status: (verdict?.status as string | undefined) ?? "almost_ready", verdict,
});
const verdictFor = (over: Record<string, unknown>) =>
  buildVerdictFixture({ projectId: PROJECT, repositoryId: PROJECT, ...over } as never);

const run = (tables: Record<string, unknown[]>) =>
  listAnalysisRunsForProject(createFakeAdmin(tables as unknown as FakeTables) as never, { projectId: PROJECT, organizationId: ORG });

describe("listAnalysisRunsForProject", () => {
  it("returns runs newest-first with verdict status", async () => {
    const runs = await run({
      scans: [scan("run-old", "2026-02-01T00:00:00Z", 72), scan("run-new", "2026-02-02T00:00:00Z", 88)],
      production_verdicts: [
        verdictRow("run-new", verdictFor({ scanId: "11111111-1111-4111-8111-0000000000a1", status: "almost_ready", blockersCount: 2 })),
        verdictRow("run-old", verdictFor({ scanId: "11111111-1111-4111-8111-0000000000a2", status: "needs_improvement", blockersCount: 5 })),
      ],
    });
    expect(runs.map((r) => r.runId)).toEqual(["run-new", "run-old"]);
    expect(runs[0]?.verdictStatus).toBe("almost_ready");
    expect(runs[1]?.verdictStatus).toBe("needs_improvement");
  });

  it("carries the CANONICAL deployment posture, not just the status (Phase 8I.1)", async () => {
    const ID = {
      full: "11111111-1111-4111-8111-000000000001",
      low: "11111111-1111-4111-8111-000000000002",
      notready: "11111111-1111-4111-8111-000000000003",
      unreadable: "11111111-1111-4111-8111-000000000004",
      none: "11111111-1111-4111-8111-000000000005",
    };
    const runs = await run({
      scans: [
        scan(ID.full, "2026-02-04T00:00:00Z", 100), scan(ID.low, "2026-02-03T00:00:00Z", 100),
        scan(ID.notready, "2026-02-02T00:00:00Z", 0), scan(ID.unreadable, "2026-02-01T00:00:00Z", 100),
        scan(ID.none, "2026-01-31T00:00:00Z", 100),
      ],
      production_verdicts: [
        verdictRow(ID.full, verdictFor({ scanId: ID.full, status: "ready_to_ship", confidence: "high", blockersCount: 0, unevaluatedAreas: [], partiallyEvaluatedAreas: [] })),
        verdictRow(ID.low, verdictFor({ scanId: ID.low, status: "ready_to_ship", confidence: "low", blockersCount: 0, unevaluatedAreas: [area("testing")] })),
        verdictRow(ID.notready, verdictFor({ scanId: ID.notready, status: "not_ready", confidence: "low", blockersCount: 10 })),
        verdictRow(ID.unreadable, { garbage: true }),
      ],
    });
    const posture = Object.fromEntries(runs.map((r) => [r.runId, r.deploymentPosture]));
    expect(posture).toEqual({
      [ID.full]: "ready",
      [ID.low]: "ready_evidence_limited", // score 100, 0 blockers, LOW + incomplete: the live-E2E case
      [ID.notready]: "not_ready",
      [ID.unreadable]: null, // an unreadable verdict can never become an approval
      [ID.none]: null, // no verdict persisted (in progress / gap)
    });
    expect(runs.find((r) => r.runId === ID.low)?.verdictStatus).toBe("ready_to_ship"); // raw status kept as metadata
  });

  it("does not attach a verdict from another project or organization to a run", async () => {
    const runs = await run({
      scans: [scan("run-a", "2026-02-01T00:00:00Z", 100)],
      production_verdicts: [
        verdictRow("run-a", verdictFor({ scanId: "11111111-1111-4111-8111-0000000000a3", status: "ready_to_ship", confidence: "high", unevaluatedAreas: [], partiallyEvaluatedAreas: [] }), "other-project", ORG),
        verdictRow("run-a", verdictFor({ scanId: "11111111-1111-4111-8111-0000000000a3", status: "ready_to_ship", confidence: "high", unevaluatedAreas: [], partiallyEvaluatedAreas: [] }), PROJECT, "other-org"),
      ],
    });
    expect(runs[0]).toMatchObject({ verdictStatus: null, deploymentPosture: null });
  });
});
