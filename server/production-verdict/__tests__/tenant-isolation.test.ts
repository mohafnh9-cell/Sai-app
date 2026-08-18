import { describe, expect, it } from "vitest";
import {
  compareProductionVerdicts,
  getCurrentProductionVerdict,
  getProductionVerdictByScan,
} from "@/server/production-verdict/core";
import {
  getCurrentProductionVerdictsForProjects,
  getProductionVerdictScanIds,
} from "@/server/production-verdict/batch-read";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { buildVerdictFixture, verdictRow } from "@/server/mcp/__tests__/verdict-fixture";

const ORG_A = "org-a-tenant";
const ORG_B = "org-b-tenant";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const SCAN_A = "22222222-2222-4222-8222-222222222222";

describe("production verdict org filter (tenant isolation)", () => {
  const verdict = buildVerdictFixture({ scanId: SCAN_A, projectId: PROJECT_A });
  const row = verdictRow(PROJECT_A, verdict, undefined, ORG_A);

  const admin = createFakeAdmin({
    production_verdicts: [row],
    repository_scan_state: [
      {
        repository_id: PROJECT_A,
        organization_id: ORG_A,
        current_verdict_id: row.id,
      },
    ],
  });

  it("getProductionVerdictByScan returns null for wrong organization (no data leak)", async () => {
    const result = await getProductionVerdictByScan(admin as never, ORG_B, SCAN_A);
    expect(result).toBeNull();
  });

  it("getProductionVerdictByScan returns verdict for matching organization", async () => {
    const result = await getProductionVerdictByScan(admin as never, ORG_A, SCAN_A);
    expect(result?.status).toBe(verdict.status);
    expect(result?.scanId).toBe(SCAN_A);
  });

  it("getCurrentProductionVerdict returns null for wrong organization (no data leak)", async () => {
    const result = await getCurrentProductionVerdict(admin as never, ORG_B, PROJECT_A);
    expect(result).toBeNull();
  });

  it("getCurrentProductionVerdict returns verdict for matching organization", async () => {
    const result = await getCurrentProductionVerdict(admin as never, ORG_A, PROJECT_A);
    expect(result?.scanId).toBe(SCAN_A);
  });

  it("getCurrentProductionVerdictsForProjects excludes cross-tenant projects", async () => {
    const map = await getCurrentProductionVerdictsForProjects(admin as never, ORG_B, [PROJECT_A]);
    expect(map.size).toBe(0);
  });

  it("getProductionVerdictScanIds excludes cross-tenant scans", async () => {
    const ids = await getProductionVerdictScanIds(admin as never, ORG_B, [SCAN_A]);
    expect(ids.size).toBe(0);
  });

  it("compareProductionVerdicts returns null when neither scan is visible in org", async () => {
    const result = await compareProductionVerdicts(admin as never, ORG_B, SCAN_A, SCAN_A);
    expect(result).toBeNull();
  });
});
