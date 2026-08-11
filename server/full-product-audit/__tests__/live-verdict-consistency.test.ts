import { describe, expect, it } from "vitest";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { runFullProductAudit } from "../orchestrate";
import { getLiveProductionVerdict } from "@/server/production-verdict/service";
import {
  buildReviewDeps,
  createFullProductAuditE2EAdmin,
  E2E_COMMIT_SHA,
  E2E_ORG_ID,
  E2E_PROJECT_ID,
  E2E_SCAN_ID,
} from "./e2e-harness";

const SCAN_B_ID = "44444444-4444-4444-8444-444444444444";
const VERDICT_ROW_ID = "99999999-9999-4999-8999-999999999999";

const infoFindings = [
  {
    id: "finding-baseline-api",
    scan_id: E2E_SCAN_ID,
    rule_id: "security.area-baseline",
    title: "api coverage evaluated",
    severity: "info",
    category: "architecture",
    file_path: ".env.example",
    recommendation: "Re-run Production Review after significant changes in this area.",
    confidence: "high",
    evidence: "Static: area=api;level=evaluated;signal=.env.example",
    created_at: new Date().toISOString(),
  },
];

function createReadyToShipAuditAdmin() {
  const verdict = buildVerdictFixture({
    projectId: E2E_PROJECT_ID,
    repositoryId: E2E_PROJECT_ID,
    scanId: E2E_SCAN_ID,
    commitSha: E2E_COMMIT_SHA,
    status: "ready_to_ship",
    score: 100,
    blockersCount: 0,
    criticalBlockersCount: 0,
    highBlockersCount: 0,
    topPriorities: [],
    findingsCount: 1,
  });
  const verdictDbRow = verdictRow(E2E_PROJECT_ID, verdict, VERDICT_ROW_ID);

  const { admin, tables } = createFullProductAuditE2EAdmin({
    scanFindings: infoFindings,
  });

  const scanIndex = tables.scans!.findIndex((scan) => scan.id === E2E_SCAN_ID);
  tables.scans![scanIndex] = {
    ...tables.scans![scanIndex],
    security_score: 100,
    files_analyzed: 50,
    files_discovered: 60,
  };

  tables.production_verdicts = [verdictDbRow];
  tables.repository_scan_state = [
    {
      repository_id: E2E_PROJECT_ID,
      organization_id: E2E_ORG_ID,
      current_verdict_id: VERDICT_ROW_ID,
      active_scan_id: null,
    },
  ];

  return admin;
}

function createDualScanAuditAdmin() {
  const verdict = buildVerdictFixture({
    projectId: E2E_PROJECT_ID,
    repositoryId: E2E_PROJECT_ID,
    scanId: E2E_SCAN_ID,
    commitSha: E2E_COMMIT_SHA,
    status: "ready_to_ship",
    score: 100,
    blockersCount: 0,
    criticalBlockersCount: 0,
    highBlockersCount: 0,
    topPriorities: [],
    findingsCount: 1,
  });
  const verdictDbRow = verdictRow(E2E_PROJECT_ID, verdict, VERDICT_ROW_ID);

  const { admin, tables } = createFullProductAuditE2EAdmin({
    scanFindings: infoFindings,
  });

  const scanIndex = tables.scans!.findIndex((scan) => scan.id === E2E_SCAN_ID);
  tables.scans![scanIndex] = {
    ...tables.scans![scanIndex],
    security_score: 100,
    files_analyzed: 50,
    files_discovered: 60,
    completed_at: "2026-01-01T00:00:00.000Z",
  };

  tables.scans!.push({
    id: SCAN_B_ID,
    organization_id: E2E_ORG_ID,
    project_id: E2E_PROJECT_ID,
    repository_id: E2E_PROJECT_ID,
    status: "completed",
    commit_sha: E2E_COMMIT_SHA,
    branch: "main",
    trigger_type: "mcp",
    review_type: "automatic",
    completed_at: "2026-01-02T00:00:00.000Z",
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    security_score: 100,
    files_analyzed: 50,
    files_discovered: 60,
    metrics: { rulesRun: 41 },
  });

  tables.production_verdicts = [verdictDbRow];
  tables.repository_scan_state = [
    {
      repository_id: E2E_PROJECT_ID,
      organization_id: E2E_ORG_ID,
      current_verdict_id: VERDICT_ROW_ID,
      active_scan_id: null,
    },
  ];

  return admin;
}

function createFreshReadAuditAdmin() {
  const verdict = buildVerdictFixture({
    projectId: E2E_PROJECT_ID,
    repositoryId: E2E_PROJECT_ID,
    scanId: E2E_SCAN_ID,
    commitSha: E2E_COMMIT_SHA,
    status: "ready_to_ship",
    score: 100,
    blockersCount: 0,
    criticalBlockersCount: 0,
    highBlockersCount: 0,
    topPriorities: [],
    findingsCount: 1,
  });
  const verdictDbRow = verdictRow(E2E_PROJECT_ID, verdict, VERDICT_ROW_ID);

  const { tables } = createFullProductAuditE2EAdmin({
    scanFindings: infoFindings,
  });

  const scanIndex = tables.scans!.findIndex((scan) => scan.id === E2E_SCAN_ID);
  tables.scans![scanIndex] = {
    ...tables.scans![scanIndex],
    security_score: 100,
    files_analyzed: 0,
    files_discovered: 0,
  };

  tables.production_verdicts = [verdictDbRow];
  tables.repository_scan_state = [
    {
      repository_id: E2E_PROJECT_ID,
      organization_id: E2E_ORG_ID,
      current_verdict_id: VERDICT_ROW_ID,
      active_scan_id: null,
    },
  ];

  let scanLoadCount = 0;
  const base = createFakeAdmin(tables);
  const admin = {
    from(table: string) {
      const query = base.from(table);
      if (table !== "scans") {
        return query;
      }

      let targetScanId: string | null = null;
      const originalEq = query.eq.bind(query);
      const originalMaybeSingle = query.maybeSingle.bind(query);

      query.eq = (col: string, value: unknown) => {
        if (col === "id") {
          targetScanId = value as string;
        }
        return originalEq(col, value);
      };

      query.maybeSingle = async () => {
        if (targetScanId === E2E_SCAN_ID) {
          scanLoadCount += 1;
          if (scanLoadCount === 2) {
            const scan = tables.scans!.find((row) => row.id === E2E_SCAN_ID);
            if (scan) {
              scan.files_analyzed = 50;
              scan.files_discovered = 60;
            }
          }
        }
        return originalMaybeSingle();
      };

      return query;
    },
  };

  return { admin, tables };
}

describe("full_product_audit live verdict consistency", () => {
  it("matches can_i_deploy when scan coverage fields are loaded for live verdict", async () => {
    const admin = createReadyToShipAuditAdmin();

    const audit = await runFullProductAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      projectName: "sequrai-app",
      repositoryFullName: "mohafnh9-cell/sequrai-app",
      githubRepo: "mohafnh9-cell/sequrai-app",
      githubRepositoryId: 4242,
      commitSha: E2E_COMMIT_SHA,
      waitForReviewMs: 500,
      waitForSecurityTestsMs: 500,
      reviewDeps: buildReviewDeps(),
    });

    const deployVerdict = await getLiveProductionVerdict(admin as never, E2E_PROJECT_ID);

    expect(audit.verdictStatus).toBe("ready_to_ship");
    expect(audit.score).toBe(100);
    expect(deployVerdict?.status).toBe("ready_to_ship");
    expect(deployVerdict?.score).toBe(100);
    expect(audit.verdictStatus).toBe(deployVerdict?.status);
    expect(audit.score).toBe(deployVerdict?.score);
    expect(audit.verdictStatus).not.toBe("insufficient_data");
    expect(audit.score).not.toBeNull();
  });

  it("uses canonical scan A for both tools when a newer completed scan B exists", async () => {
    const admin = createDualScanAuditAdmin();

    const audit = await runFullProductAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      projectName: "sequrai-app",
      repositoryFullName: "mohafnh9-cell/sequrai-app",
      githubRepo: "mohafnh9-cell/sequrai-app",
      githubRepositoryId: 4242,
      commitSha: E2E_COMMIT_SHA,
      waitForReviewMs: 500,
      waitForSecurityTestsMs: 500,
      reviewDeps: buildReviewDeps(),
    });

    const deployVerdict = await getLiveProductionVerdict(admin as never, E2E_PROJECT_ID);

    expect(audit.reviewId).toBe(E2E_SCAN_ID);
    expect(deployVerdict?.scanId).toBe(E2E_SCAN_ID);
    expect(deployVerdict?.scanId).not.toBe(SCAN_B_ID);
    expect(audit.verdictStatus).toBe("ready_to_ship");
    expect(audit.score).toBe(100);
    expect(deployVerdict?.status).toBe("ready_to_ship");
    expect(deployVerdict?.score).toBe(100);
    expect(audit.verdictStatus).toBe(deployVerdict?.status);
    expect(audit.score).toBe(deployVerdict?.score);
  });

  it("re-fetches the scan row before computing the live verdict", async () => {
    const { admin } = createFreshReadAuditAdmin();

    const audit = await runFullProductAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      projectName: "sequrai-app",
      repositoryFullName: "mohafnh9-cell/sequrai-app",
      githubRepo: "mohafnh9-cell/sequrai-app",
      githubRepositoryId: 4242,
      commitSha: E2E_COMMIT_SHA,
      waitForReviewMs: 500,
      waitForSecurityTestsMs: 500,
      reviewDeps: buildReviewDeps(),
    });

    const deployVerdict = await getLiveProductionVerdict(admin as never, E2E_PROJECT_ID);

    expect(audit.verdictStatus).toBe("ready_to_ship");
    expect(audit.score).toBe(100);
    expect(deployVerdict?.status).toBe("ready_to_ship");
    expect(deployVerdict?.score).toBe(100);
    expect(audit.verdictStatus).toBe(deployVerdict?.status);
    expect(audit.score).toBe(deployVerdict?.score);
  });
});

describe("full_product_audit dual scan regression", () => {
  it("does not let can_i_deploy prefer scan B when current_verdict points to scan A with zero coverage", async () => {
    const verdict = buildVerdictFixture({
      projectId: E2E_PROJECT_ID,
      repositoryId: E2E_PROJECT_ID,
      scanId: E2E_SCAN_ID,
      commitSha: E2E_COMMIT_SHA,
      status: "ready_to_ship",
      score: 100,
      blockersCount: 0,
      criticalBlockersCount: 0,
      highBlockersCount: 0,
      topPriorities: [],
      findingsCount: 1,
    });
    const verdictDbRow = verdictRow(E2E_PROJECT_ID, verdict, VERDICT_ROW_ID);

    const tables: FakeTables = {
      projects: [
        {
          id: E2E_PROJECT_ID,
          name: "sequrai-app",
          organization_id: E2E_ORG_ID,
          github_repo: "mohafnh9-cell/sequrai-app",
          github_repository_id: 4242,
          github_last_commit_sha: E2E_COMMIT_SHA,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      scans: [
        {
          id: E2E_SCAN_ID,
          organization_id: E2E_ORG_ID,
          project_id: E2E_PROJECT_ID,
          repository_id: E2E_PROJECT_ID,
          status: "completed",
          commit_sha: E2E_COMMIT_SHA,
          branch: "main",
          trigger_type: "mcp",
          review_type: "manual",
          completed_at: "2026-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          security_score: 100,
          files_analyzed: 0,
          files_discovered: 0,
          metrics: { rulesRun: 41 },
        },
        {
          id: SCAN_B_ID,
          organization_id: E2E_ORG_ID,
          project_id: E2E_PROJECT_ID,
          repository_id: E2E_PROJECT_ID,
          status: "completed",
          commit_sha: E2E_COMMIT_SHA,
          branch: "main",
          trigger_type: "mcp",
          review_type: "automatic",
          completed_at: "2026-01-02T00:00:00.000Z",
          created_at: "2026-01-02T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          security_score: 100,
          files_analyzed: 50,
          files_discovered: 60,
          metrics: { rulesRun: 41 },
        },
      ],
      scan_findings: infoFindings,
      scan_jobs: [],
      production_verdicts: [verdictDbRow],
      repository_scan_state: [
        {
          repository_id: E2E_PROJECT_ID,
          organization_id: E2E_ORG_ID,
          current_verdict_id: VERDICT_ROW_ID,
          active_scan_id: null,
        },
      ],
    };

    const admin = createFakeAdmin(tables);
    const deployVerdict = await getLiveProductionVerdict(admin as never, E2E_PROJECT_ID);

    expect(deployVerdict?.scanId).toBe(E2E_SCAN_ID);
    expect(deployVerdict?.status).toBe("insufficient_data");
    expect(deployVerdict?.score).toBeNull();
  });
});
