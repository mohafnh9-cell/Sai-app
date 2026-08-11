import { describe, expect, it } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
import {
  computeLiveProductionVerdict,
  getLiveProductionVerdict,
  loadLiveVerdictScanRow,
} from "../live-verdict";

const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const SCAN_A_ID = "11111111-1111-4111-8111-111111111111";
const SCAN_B_ID = "22222222-2222-4222-8222-222222222222";
const COMMIT_SHA = "1599cb52240f59412d9d0189082f8eb194d812aa";
const VERDICT_ROW_ID = "33333333-3333-4333-8333-333333333333";

const infoFinding = {
  id: "finding-info-1",
  scan_id: SCAN_A_ID,
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
        id: SCAN_A_ID,
        project_id: PROJECT_ID,
        repository_id: PROJECT_ID,
        status: "completed",
        commit_sha: COMMIT_SHA,
        branch: "main",
        security_score: 100,
        files_analyzed: 50,
        files_discovered: 60,
        completed_at: new Date().toISOString(),
        ...scanOverrides,
      },
    ],
    scan_findings: [infoFinding],
  });
}

function buildDualScanAdmin() {
  const verdict = buildVerdictFixture({
    projectId: PROJECT_ID,
    repositoryId: PROJECT_ID,
    scanId: SCAN_A_ID,
    commitSha: COMMIT_SHA,
    status: "ready_to_ship",
    score: 100,
    blockersCount: 0,
    criticalBlockersCount: 0,
    highBlockersCount: 0,
    topPriorities: [],
    findingsCount: 1,
  });
  const verdictDbRow = verdictRow(PROJECT_ID, verdict, VERDICT_ROW_ID);

  return createFakeAdmin({
    scans: [
      {
        id: SCAN_A_ID,
        project_id: PROJECT_ID,
        repository_id: PROJECT_ID,
        status: "completed",
        commit_sha: COMMIT_SHA,
        branch: "main",
        security_score: 100,
        files_analyzed: 0,
        files_discovered: 0,
        completed_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: SCAN_B_ID,
        project_id: PROJECT_ID,
        repository_id: PROJECT_ID,
        status: "completed",
        commit_sha: COMMIT_SHA,
        branch: "main",
        security_score: 100,
        files_analyzed: 50,
        files_discovered: 60,
        completed_at: "2026-01-02T00:00:00.000Z",
      },
    ],
    scan_findings: [infoFinding],
    production_verdicts: [verdictDbRow],
    repository_scan_state: [
      {
        repository_id: PROJECT_ID,
        current_verdict_id: VERDICT_ROW_ID,
        active_scan_id: null,
      },
    ],
  });
}

describe("computeLiveProductionVerdict scan row completeness", () => {
  it("returns insufficient_data when orchestrate passes a partial scan row", async () => {
    const admin = buildAdmin();
    const verdict = await computeLiveProductionVerdict(admin as never, {
      projectId: PROJECT_ID,
      scan: {
        id: SCAN_A_ID,
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
        id: SCAN_A_ID,
        commit_sha: COMMIT_SHA,
        branch: "main",
        status: "completed",
        security_score: 100,
        files_analyzed: 50,
        files_discovered: 60,
        repository_id: PROJECT_ID,
      },
    });

    expect(verdict?.status).toBe("ready_to_ship");
    expect(verdict?.score).toBe(100);
    expect(verdict?.blockersCount).toBe(0);
  });
});

describe("getLiveProductionVerdict canonical scan resolution", () => {
  it("uses persisted scanId instead of the latest completed scan", async () => {
    const admin = buildDualScanAdmin();

    const verdict = await getLiveProductionVerdict(admin as never, PROJECT_ID);

    expect(verdict?.scanId).toBe(SCAN_A_ID);
    expect(verdict?.status).toBe("insufficient_data");
    expect(verdict?.score).toBeNull();
  });

  it("falls back to latest completed scan when no persisted verdict exists", async () => {
    const admin = createFakeAdmin({
      scans: [
        {
          id: SCAN_A_ID,
          project_id: PROJECT_ID,
          repository_id: PROJECT_ID,
          status: "completed",
          commit_sha: COMMIT_SHA,
          branch: "main",
          security_score: 100,
          files_analyzed: 0,
          files_discovered: 0,
          completed_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: SCAN_B_ID,
          project_id: PROJECT_ID,
          repository_id: PROJECT_ID,
          status: "completed",
          commit_sha: COMMIT_SHA,
          branch: "main",
          security_score: 100,
          files_analyzed: 50,
          files_discovered: 60,
          completed_at: "2026-01-02T00:00:00.000Z",
        },
      ],
      scan_findings: [{ ...infoFinding, scan_id: SCAN_B_ID }],
    });

    const liveVerdict = await getLiveProductionVerdict(admin as never, PROJECT_ID);

    expect(liveVerdict?.scanId).toBe(SCAN_B_ID);
    expect(liveVerdict?.status).toBe("ready_to_ship");
    expect(liveVerdict?.score).toBe(100);
  });
});

describe("loadLiveVerdictScanRow", () => {
  it("reads the canonical scan row from the database", async () => {
    const admin = buildDualScanAdmin();
    const scanRow = await loadLiveVerdictScanRow(admin as never, SCAN_A_ID);

    expect(scanRow?.id).toBe(SCAN_A_ID);
    expect(scanRow?.files_analyzed).toBe(0);
    expect(scanRow?.security_score).toBe(100);
  });
});
