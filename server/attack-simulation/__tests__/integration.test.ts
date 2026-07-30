import { describe, expect, it } from "vitest";
import type { RedTeamReport } from "@/server/ai-red-team/types";
import { extractAttackHypothesesFromRedTeamReport } from "@/server/attack-simulation/integration/extract-hypotheses-from-report";
import {
  applyAttackSimulationVerdictOverlay,
  buildAttackSimulationVerdictOverlay,
} from "@/server/attack-simulation/integration/build-verdict-overlay";
import { resolveAttackRuntimeModeForScan } from "@/server/attack-simulation/integration/resolve-runtime-mode";

describe("attack simulation platform integration", () => {
  it("extracts deduplicated red team findings into attack hypotheses", () => {
    const report = {
      requestId: "req-1",
      discovery: {} as RedTeamReport["discovery"],
      plan: {} as RedTeamReport["plan"],
      summary: {} as RedTeamReport["summary"],
      executions: [],
      generatedAt: new Date().toISOString(),
      results: [],
      intelligence: {
        deduplicatedFindings: [
          {
            id: "f1",
            title: "Cross-tenant record access",
            description: "Tenant B can read tenant A records",
            domain: "authorization",
            severity: "high",
            confidence: 0.82,
            evidenceIds: [],
            metadata: { adapterHint: "idor-cross-tenant" },
          },
        ],
      },
    } as RedTeamReport;

    const hypotheses = extractAttackHypothesesFromRedTeamReport(report);
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].adapterHint).toBe("idor-cross-tenant");
    expect(hypotheses[0].category).toBe("authorization");
  });

  it("resolves authorized staging runtime when staging authorization exists", () => {
    const mode = resolveAttackRuntimeModeForScan({
      authorization: {
        id: "auth-1",
        organizationId: "org",
        projectId: "proj",
        targetOrigin: "https://staging.example.com",
        environmentType: "staging",
        status: "approved",
        authorizationMethod: "manual",
        approvedScope: {},
        createdBy: null,
        approvedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        testCredentialsRef: null,
        pathExclusions: [],
        redirectAllowlist: [],
        maxRequestBudget: 50,
        maxDurationSeconds: 900,
        commitSha: null,
      },
    });
    expect(mode).toBe("authorized_staging");
  });

  it("applies attack simulation overlay onto production verdict payload", () => {
    const verdict = {
      version: "1",
      projectId: "55555555-5555-4555-8555-555555555555",
      status: "almost_ready",
      score: 72,
    };

    const overlay = {
      campaignId: "11111111-1111-4111-8111-111111111111",
      campaignStatus: "running",
      totalExecutions: 2,
      confirmedFindings: 1,
      notExploitableFindings: 0,
      protectedExecutions: 0,
      stillVulnerableExecutions: 0,
      blockedExecutions: 0,
      pendingReplay: 1,
      headline: "1 attack scenario confirmed; replay verification pending.",
    };

    const merged = applyAttackSimulationVerdictOverlay(verdict, overlay);
    expect(merged.attackSimulation?.confirmedFindings).toBe(1);
    expect(merged.status).toBe("almost_ready");
  });

  it("returns null overlay when no campaign exists for scan", async () => {
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as never;

    const overlay = await buildAttackSimulationVerdictOverlay(admin, {
      scanId: "44444444-4444-4444-8444-444444444444",
      organizationId: "66666666-6666-4666-8666-666666666666",
      projectId: "55555555-5555-4555-8555-555555555555",
    });

    expect(overlay).toBeNull();
  });
});
