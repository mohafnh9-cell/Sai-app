import { describe, expect, it } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { computeLiveProductionVerdict } from "../live-verdict";

const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const SCAN_ID = "11111111-1111-4111-8111-111111111111";
const COMMIT_SHA = "1599cb52240f59412d9d0189082f8eb194d812aa";

const infoFinding = {
  id: "finding-info-1",
  scan_id: SCAN_ID,
  rule_id: "security.area-baseline",
  title: "api coverage evaluated",
  severity: "info",
  category: "architecture",
  file_path: ".env.example",
  recommendation: "Monitor",
  confidence: "high",
  evidence: "Static: area=api;level=evaluated",
  created_at: new Date().toISOString(),
};

function buildAdmin(scanOverrides: Record<string, unknown> = {}) {
  return createFakeAdmin({
    scans: [
      {
        id: SCAN_ID,
        project_id: PROJECT_ID,
        repository_id: PROJECT_ID,
        status: "completed",
        commit_sha: COMMIT_SHA,
        branch: "main",
        security_score: 100,
        files_analyzed: 50,
        files_scanned: 50,
        files_discovered: 60,
        total_files: 60,
        completed_at: new Date().toISOString(),
        ...scanOverrides,
      },
    ],
    scan_findings: [infoFinding],
  });
}

describe("computeLiveProductionVerdict scan row completeness", () => {
  it("returns insufficient_data when orchestrate passes a partial scan row", async () => {
    const admin = buildAdmin();
    const verdict = await computeLiveProductionVerdict(admin as never, {
      projectId: PROJECT_ID,
      scan: {
        id: SCAN_ID,
        commit_sha: COMMIT_SHA,
        status: "completed",
      },
    });

    expect(verdict?.status).toBe("insufficient_data");
    expect(verdict?.score).toBeNull();
    expect(verdict?.blockersCount).toBe(0);
  });

  it("returns ready_to_ship with score 100 when scan coverage fields are present", async () => {
    const admin = buildAdmin();
    const verdict = await computeLiveProductionVerdict(admin as never, {
      projectId: PROJECT_ID,
      scan: {
        id: SCAN_ID,
        commit_sha: COMMIT_SHA,
        branch: "main",
        status: "completed",
        security_score: 100,
        files_analyzed: 50,
        files_scanned: 50,
        files_discovered: 60,
        total_files: 60,
        repository_id: PROJECT_ID,
      },
    });

    expect(verdict?.status).toBe("ready_to_ship");
    expect(verdict?.score).toBe(100);
    expect(verdict?.blockersCount).toBe(0);
  });
});
