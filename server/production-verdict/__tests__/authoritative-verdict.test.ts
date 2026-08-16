import { describe, expect, it } from "vitest";
import { getAuthoritativeProductionVerdict } from "@/server/production-verdict/authoritative-verdict";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("getAuthoritativeProductionVerdict", () => {
  it("returns persisted verdict as authoritative", async () => {
    const verdict = buildVerdictFixture({ status: "ready_to_ship", score: 88, blockersCount: 0 });
    const row = verdictRow(PROJECT_ID, verdict);
    const admin = createFakeAdmin({
      repository_scan_state: [{ repository_id: PROJECT_ID, current_verdict_id: row.id }],
      production_verdicts: [row],
      scans: [
        {
          id: verdict.scanId,
          project_id: PROJECT_ID,
          repository_id: PROJECT_ID,
          status: "completed",
          commit_sha: verdict.commitSha,
          branch: "main",
          security_score: 88,
          files_analyzed: 10,
          files_discovered: 10,
        },
      ],
      scan_findings: [],
    });

    const result = await getAuthoritativeProductionVerdict(admin as never, PROJECT_ID);
    expect(result?.authoritative).toBe("persisted");
    expect(result?.verdict.status).toBe("ready_to_ship");
    expect(result?.consistency).toBe("consistent");
  });
});
