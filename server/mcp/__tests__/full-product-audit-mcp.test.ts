import { describe, expect, it, vi, beforeEach } from "vitest";
import type { McpAuthContext } from "@/server/mcp/auth";
import { getMcpTranslator } from "@/server/mcp/i18n";
import {
  MCP_FULL_PRODUCT_AUDIT_REVIEW_WAIT_MS,
  MCP_FULL_PRODUCT_AUDIT_SECURITY_WAIT_MS,
} from "@/server/mcp/tools/full-product-audit";
import { createFakeAdmin, type FakeTables } from "./fake-admin";
import { buildVerdictFixture, verdictRow } from "./verdict-fixture";

const ORG = "66666666-6666-4666-8666-666666666666";
const PROJECT = "55555555-5555-4555-8555-555555555555";

const runFullProductAuditMock = vi.fn();

vi.mock("@/server/full-product-audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/full-product-audit")>();
  return {
    ...actual,
    runFullProductAudit: (...args: unknown[]) => runFullProductAuditMock(...args),
  };
});

import { fullProductAudit } from "@/server/mcp/tools/full-product-audit";

function ctxFor(admin: ReturnType<typeof createFakeAdmin>): McpAuthContext {
  return {
    keyId: "key-1",
    organizationId: ORG,
    userId: "user-1",
    admin: admin as unknown as McpAuthContext["admin"],
  };
}

describe("MCP full_product_audit integration", () => {
  beforeEach(() => {
    runFullProductAuditMock.mockReset();
    runFullProductAuditMock.mockResolvedValue({
      mode: "full_product_audit",
      phase: "complete",
      project: { id: PROJECT, name: "Lab", repositoryFullName: "acme/lab" },
      reviewId: "scan-1",
      commitSha: "abc1234567890abcdef1234567890abcdef12345678",
      verdictStatus: "not_ready",
      score: 50,
      counts: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        info: 0,
        confirmed: 0,
        likely: 0,
        potential: 1,
        notReproduced: 0,
        falsePositive: 0,
        notApplicable: 0,
      },
      topRisks: [],
      whatToFixFirst: [],
      findings: [],
      engines: {
        codeReview: { scanId: "scan-1", findingsCount: 1, rulesRun: 1 },
        securityTesting: {
          campaignId: null,
          executionsRun: 0,
          executionsCompleted: 0,
          adaptersExecuted: [],
          adaptersSelectedFromFindings: [],
          runtimeMode: "mock",
          dynamicTargetSource: "none",
          skippedReason: null,
          notSafelyTestableCount: 0,
        },
      },
      dynamicVerification: {
        offered: false,
        decision: null,
        authorizedTarget: null,
        awaitingUrl: false,
        awaitingAuthorization: false,
        awaitingScopeApproval: false,
        notSafelyTestableCount: 0,
      },
      safeFixAvailable: false,
      safeFixBlockerId: null,
      recommendation: "Fix issues",
      summary: "",
      timedOut: false,
      nextAction: "Review findings",
    });
  });

  it("passes bounded wait budgets to runFullProductAudit", async () => {
    const verdict = buildVerdictFixture({ projectId: PROJECT, repositoryId: PROJECT });
    const tables: FakeTables = {
      projects: [
        {
          id: PROJECT,
          name: "Lab",
          github_repo: "acme/lab",
          github_repository_id: 1,
          organization_id: ORG,
          created_at: new Date().toISOString(),
        },
      ],
      production_verdicts: [verdictRow(PROJECT, verdict)],
      repository_scan_state: [],
      scans: [],
      scan_findings: [],
      profiles: [],
    };

    await fullProductAudit(ctxFor(createFakeAdmin(tables)), {}, getMcpTranslator("en"));

    expect(runFullProductAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        waitForReviewMs: MCP_FULL_PRODUCT_AUDIT_REVIEW_WAIT_MS,
        waitForSecurityTestsMs: MCP_FULL_PRODUCT_AUDIT_SECURITY_WAIT_MS,
      })
    );
  });

  it("exports MCP wait budgets sized for HTTP tool responses", () => {
    expect(MCP_FULL_PRODUCT_AUDIT_REVIEW_WAIT_MS).toBe(50_000);
    expect(MCP_FULL_PRODUCT_AUDIT_SECURITY_WAIT_MS).toBe(50_000);
    expect(MCP_FULL_PRODUCT_AUDIT_REVIEW_WAIT_MS + MCP_FULL_PRODUCT_AUDIT_SECURITY_WAIT_MS).toBeLessThan(
      120_000
    );
  });
});

describe("MCP route duration guard", () => {
  it("allows full_product_audit to run up to 300 seconds on the server", async () => {
    const routeModule = await import("@/app/api/mcp/route");
    expect(routeModule.maxDuration).toBe(300);
  });
});
