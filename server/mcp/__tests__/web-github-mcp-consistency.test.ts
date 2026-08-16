import { describe, expect, it } from "vitest";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import {
  formatGithubCheckDescription,
  formatGithubCheckSummary,
} from "@/brain/production-verdict/adapters/format";
import { productionReadyFromVerdict } from "@/server/brain/verdict-view-model";
import { heroViewFromVerdict } from "@/brain/production-verdict/hero-view";
import type { McpAuthContext } from "@/server/mcp/auth";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { canIDeploy } from "@/server/mcp/tools/can-i-deploy";
import { createFakeAdmin, type FakeTables } from "./fake-admin";
import { buildVerdictFixture, verdictRow } from "./verdict-fixture";
import { testMcpAuthContext } from "./test-context";

/**
 * MCP V1 §14 — web, GitHub automation and MCP must agree on product truth
 * for the same organization/project/repository/commit/persisted verdict.
 * Formatting may differ; the underlying score, status, blockers count, top
 * priority/next action, and reviewed commit must not.
 *
 * All three surfaces are exercised through the exact same retrieval path
 * (`getCurrentProductionVerdict`) and the exact same production-verdict.ts
 * adapters/tools used in production, so there is no risk of drift between
 * this test and the real code paths.
 */
const ORG_A = "org-a";
const PROJECT_1 = "11111111-1111-4111-8111-111111111111";

function ctxFor(admin: ReturnType<typeof createFakeAdmin>): McpAuthContext {
  return testMcpAuthContext(admin, { organizationId: ORG_A });
}

function baseTables(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    projects: [
      { id: PROJECT_1, name: "Alpha", github_repo: "acme/alpha", organization_id: ORG_A, created_at: "2026-01-01" },
    ],
    production_verdicts: [],
    repository_scan_state: [],
    scan_findings: [],
    scans: [],
    profiles: [],
    ...overrides,
  };
}

const t = getMcpTranslator("en");

describe("web / GitHub / MCP consistency", () => {
  it("agrees on status, score, blockers count, top priority, and reviewed commit", async () => {
    const verdict = buildVerdictFixture({
      status: "not_ready",
      score: 64,
      blockersCount: 2,
      commitSha: "abc1234567",
    });
    const admin = createFakeAdmin(baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] }));

    // All three surfaces read the persisted verdict through the same service
    // used in production — this is the single source of truth.
    const retrieved = await getCurrentProductionVerdict(admin as never, PROJECT_1);
    expect(retrieved).not.toBeNull();
    if (!retrieved) return;

    const webReady = productionReadyFromVerdict(retrieved);
    const webHero = heroViewFromVerdict(retrieved);
    const githubSummary = formatGithubCheckSummary({ verdict: retrieved });
    const githubDescription = formatGithubCheckDescription(retrieved);
    const mcpResult = await canIDeploy(ctxFor(admin), {}, t);

    // Score
    expect(webReady.overall).toBe(64);
    expect(mcpResult.score).toBe(64);
    expect(githubSummary).toContain("64/100");
    expect(githubDescription).toContain("64/100");

    // Blockers count
    expect(webReady.blockersCount).toBe(2);
    expect(mcpResult.blockersCount).toBe(2);
    expect(githubDescription).toContain("2 blockers");

    // Verdict status (readiness) agrees across surfaces
    expect(webReady.readyForProduction).toBe(false);
    expect(mcpResult.verdictStatus).toBe("not_ready");
    expect(mcpResult.deploymentRecommendation).toBe("DO_NOT_DEPLOY");

    // Top priority / next action comes from the same recommendedAction and
    // topPriorities fields for every surface.
    expect(webHero.headline).toBeTruthy();
    expect(mcpResult.nextAction).toBe(t("actions.applySafeFix"));
    expect(githubSummary).toContain(retrieved.topPriorities[0].title);
    expect(mcpResult.topBlockers[0].title).toBe(retrieved.topPriorities[0].title);

    // Reviewed commit
    expect(mcpResult.reviewedCommitSha).toBe("abc1234567");
    expect(retrieved.commitSha).toBe("abc1234567");
  });

  it("agrees on null score (never coerced to zero) across surfaces", async () => {
    const verdict = buildVerdictFixture({
      status: "insufficient_data",
      score: null,
      blockersCount: 0,
      topPriorities: [],
    });
    const admin = createFakeAdmin(baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] }));

    const retrieved = await getCurrentProductionVerdict(admin as never, PROJECT_1);
    expect(retrieved).not.toBeNull();
    if (!retrieved) return;

    const webReady = productionReadyFromVerdict(retrieved);
    const githubSummary = formatGithubCheckSummary({ verdict: retrieved });
    const mcpResult = await canIDeploy(ctxFor(admin), {}, t);

    expect(webReady.overall).toBeNull();
    expect(mcpResult.score).toBeNull();
    expect(githubSummary).toContain("Production Ready Score unavailable");
    expect(mcpResult.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
  });

  it("agrees on a ready_to_ship verdict with zero blockers", async () => {
    const verdict = buildVerdictFixture({
      status: "ready_to_ship",
      score: 97,
      blockersCount: 0,
      criticalBlockersCount: 0,
      highBlockersCount: 0,
      topPriorities: [],
    });
    const admin = createFakeAdmin(baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] }));

    const retrieved = await getCurrentProductionVerdict(admin as never, PROJECT_1);
    expect(retrieved).not.toBeNull();
    if (!retrieved) return;

    const webReady = productionReadyFromVerdict(retrieved);
    const mcpResult = await canIDeploy(ctxFor(admin), {}, t);

    expect(webReady.readyForProduction).toBe(true);
    expect(mcpResult.verdictStatus).toBe("ready_to_ship");
    expect(mcpResult.deploymentRecommendation).toBe("SHIP_IT");
    expect(webReady.blockersCount).toBe(0);
    expect(mcpResult.blockersCount).toBe(0);
  });
});
