import { describe, expect, it } from "vitest";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";
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
  const verdictDbRow = verdictRow(E2E_PROJECT_ID, verdict);

  const { admin, tables } = createFullProductAuditE2EAdmin({
    scanFindings: infoFindings,
  });

  const scanIndex = tables.scans!.findIndex((scan) => scan.id === E2E_SCAN_ID);
  tables.scans![scanIndex] = {
    ...tables.scans![scanIndex],
    security_score: 100,
    files_analyzed: 50,
    files_scanned: 50,
    files_discovered: 60,
    total_files: 60,
  };

  tables.production_verdicts = [verdictDbRow];
  tables.repository_scan_state = [
    {
      repository_id: E2E_PROJECT_ID,
      organization_id: E2E_ORG_ID,
      current_verdict_id: verdictDbRow.id,
      active_scan_id: null,
    },
  ];

  return admin;
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
});
