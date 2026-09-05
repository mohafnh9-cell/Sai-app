import { describe, expect, it, vi, beforeEach } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

const ORG_A = "org-a";
const ORG_B = "org-b";
const PROJECT_A = "project-a";
const SCAN_A = "scan-a";

const CATEGORY_A_FINDING = {
  id: "finding-a1",
  scan_id: SCAN_A,
  organization_id: ORG_A,
  project_id: PROJECT_A,
  rule_id: "secrets.exposed",
  title: "Hard-coded secret",
  severity: "critical",
  confidence: "high",
  category: "secrets",
  file_path: "lib/config.ts",
  start_line: 3,
  recommendation: "Rotate the credential",
  evidence: "sk_live_xxx",
};

const CATEGORY_C_FINDING_1 = {
  id: "finding-c1",
  scan_id: SCAN_A,
  organization_id: ORG_A,
  project_id: PROJECT_A,
  rule_id: "authz.insufficient",
  title: "Insufficient authorization",
  severity: "medium",
  confidence: "medium",
  category: "authorization",
  file_path: "app/api/widgets/route.ts",
  start_line: 10,
  recommendation: "Add an authz check",
  evidence: "no recognized auth pattern",
};

const CATEGORY_C_FINDING_2 = {
  id: "finding-c2",
  scan_id: SCAN_A,
  organization_id: ORG_A,
  project_id: PROJECT_A,
  rule_id: "injection.ssrf",
  title: "Potential SSRF",
  severity: "high",
  confidence: "medium",
  category: "injection",
  file_path: "server/fetch.ts",
  start_line: 4,
  recommendation: "Allowlist hosts",
  evidence: "fetch(userInput)",
};

let analyzeMock: ReturnType<typeof vi.fn>;

vi.mock("../analyze", () => ({
  analyzeCategoryCFindings: (...args: unknown[]) => (analyzeMock as (...a: unknown[]) => unknown)(...args),
}));

// Budget check hits a real table query against the fake admin -- no rows
// exist for it by default, so it naturally passes (empty usage) without
// needing its own mock.

beforeEach(() => {
  analyzeMock = vi.fn().mockResolvedValue({ ok: true, findings: [], attackChains: [], model: "m", tokensUsed: 5 });
  vi.resetModules();
});

function buildAdmin(tables: FakeTables) {
  return createFakeAdmin(tables) as never;
}

describe("Phase 30 -- runScanAiReasoning orchestrator", () => {
  it("L: zero Category C findings -> Claude is never called, overlay persisted as skipped", async () => {
    const tables: FakeTables = { scan_findings: [CATEGORY_A_FINDING], ai_finding_reasoning: [] };
    const admin = buildAdmin(tables);
    const { runScanAiReasoning } = await import("../run-scan-reasoning");
    await runScanAiReasoning(admin, { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A });

    expect(analyzeMock).not.toHaveBeenCalled();
    expect(tables.ai_finding_reasoning).toHaveLength(1);
    expect(tables.ai_finding_reasoning[0].status).toBe("skipped");
  });

  it("M: multiple Category C findings -> exactly one Claude call, not one per finding", async () => {
    const tables: FakeTables = {
      scan_findings: [CATEGORY_A_FINDING, CATEGORY_C_FINDING_1, CATEGORY_C_FINDING_2],
      ai_finding_reasoning: [],
    };
    const admin = buildAdmin(tables);
    const { runScanAiReasoning } = await import("../run-scan-reasoning");
    await runScanAiReasoning(admin, { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A });

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    const [evidenceArg] = analyzeMock.mock.calls[0];
    expect(evidenceArg).toHaveLength(2);
    expect(tables.ai_finding_reasoning[0].status).toBe("completed");
  });

  it("Q: AI analysis failure does not throw and still persists a non-fatal failed overlay", async () => {
    analyzeMock.mockResolvedValue({ ok: false, reason: "timeout" });
    const tables: FakeTables = { scan_findings: [CATEGORY_C_FINDING_1], ai_finding_reasoning: [] };
    const admin = buildAdmin(tables);
    const { runScanAiReasoning } = await import("../run-scan-reasoning");
    await expect(
      runScanAiReasoning(admin, { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A })
    ).resolves.toBeUndefined();
    expect(tables.ai_finding_reasoning[0].status).toBe("failed");
    expect(tables.ai_finding_reasoning[0].failure_reason).toBe("timeout");
  });

  it("an unexpected thrown error anywhere in the pipeline is swallowed, never propagated", async () => {
    analyzeMock.mockRejectedValue(new Error("boom"));
    const tables: FakeTables = { scan_findings: [CATEGORY_C_FINDING_1], ai_finding_reasoning: [] };
    const admin = buildAdmin(tables);
    const { runScanAiReasoning } = await import("../run-scan-reasoning");
    await expect(
      runScanAiReasoning(admin, { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A })
    ).resolves.toBeUndefined();
  });

  it("N: a matching completed cache row for the same project+evidence hash is reused, Claude is not called", async () => {
    const tables: FakeTables = {
      scan_findings: [CATEGORY_C_FINDING_1],
      ai_finding_reasoning: [],
    };
    const admin = buildAdmin(tables);
    const { runScanAiReasoning } = await import("../run-scan-reasoning");
    const { computeEvidenceHash } = await import("../build-context");

    // Seed a prior completed reasoning row for the same project + evidence hash.
    const hash = computeEvidenceHash([CATEGORY_C_FINDING_1 as never]);
    tables.ai_finding_reasoning.push({
      id: "prior",
      organization_id: ORG_A,
      project_id: PROJECT_A,
      scan_id: "prior-scan",
      status: "completed",
      reasoning_version: "v1",
      evidence_hash: hash,
      model: "cached-model",
      findings: [],
      attack_chains: [],
      tokens_used: 3,
      created_at: new Date().toISOString(),
    });

    await runScanAiReasoning(admin, { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A });

    expect(analyzeMock).not.toHaveBeenCalled();
    const newRow = tables.ai_finding_reasoning.find((r) => r.scan_id === SCAN_A);
    expect(newRow?.status).toBe("completed");
    expect(newRow?.cache_hit).toBe(true);
  });

  it("O: different Category C findings (different evidence hash) do not hit the cache, Claude is called", async () => {
    const tables: FakeTables = {
      scan_findings: [CATEGORY_C_FINDING_1],
      ai_finding_reasoning: [
        {
          id: "prior",
          organization_id: ORG_A,
          project_id: PROJECT_A,
          scan_id: "prior-scan",
          status: "completed",
          reasoning_version: "v1",
          evidence_hash: "a-totally-different-hash",
          model: "cached-model",
          findings: [],
          attack_chains: [],
          tokens_used: 3,
          created_at: new Date().toISOString(),
        },
      ],
    };
    const admin = buildAdmin(tables);
    const { runScanAiReasoning } = await import("../run-scan-reasoning");
    await runScanAiReasoning(admin, { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A });

    expect(analyzeMock).toHaveBeenCalledTimes(1);
  });

  it("P: organization B's reasoning run never reads organization A's findings (tenant isolation)", async () => {
    const tables: FakeTables = {
      scan_findings: [CATEGORY_C_FINDING_1], // belongs to ORG_A
      ai_finding_reasoning: [],
    };
    const admin = buildAdmin(tables);
    const { runScanAiReasoning } = await import("../run-scan-reasoning");

    // Same scan id, but requested under ORG_B -- the org-scoped query must find nothing.
    await runScanAiReasoning(admin, { organizationId: ORG_B, projectId: "project-b", scanId: SCAN_A });

    expect(analyzeMock).not.toHaveBeenCalled();
    const row = tables.ai_finding_reasoning.find((r) => r.organization_id === ORG_B);
    expect(row?.status).toBe("skipped");
    // No row was ever written under organization A as a side effect of organization B's run.
    expect(tables.ai_finding_reasoning.some((r) => r.organization_id === ORG_A)).toBe(false);
  });

  it("R: the orchestrator never writes to scan_findings or production_verdicts -- only reads findings and writes its own overlay table", async () => {
    const tables: FakeTables = {
      scan_findings: [CATEGORY_C_FINDING_1],
      ai_finding_reasoning: [],
      production_verdicts: [],
    };
    const admin = buildAdmin(tables);
    const { runScanAiReasoning } = await import("../run-scan-reasoning");
    await runScanAiReasoning(admin, { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A });

    // scan_findings still has exactly the one seeded row -- nothing added/mutated by AI reasoning.
    expect(tables.scan_findings).toHaveLength(1);
    expect(tables.scan_findings[0]).toEqual(CATEGORY_C_FINDING_1);
    expect(tables.production_verdicts).toHaveLength(0);
  });
});
