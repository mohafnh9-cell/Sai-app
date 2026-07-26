import { describe, expect, it } from "vitest";
import type { McpAuthContext } from "@/server/mcp/auth";
import { McpError } from "@/server/mcp/auth";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { canIDeploy } from "@/server/mcp/tools/can-i-deploy";
import { productionHistory } from "@/server/mcp/tools/production-history";
import { safeFix } from "@/server/mcp/tools/safe-fix";
import { whatChanged } from "@/server/mcp/tools/what-changed";
import { createFakeAdmin, type FakeTables } from "./fake-admin";
import { buildVerdictFixture, verdictRow } from "./verdict-fixture";

const ORG_A = "org-a";
const ORG_B = "org-b";
const PROJECT_1 = "11111111-1111-4111-8111-111111111111";
const PROJECT_2 = "22222222-2222-4222-8222-222222222222";

function ctxFor(admin: ReturnType<typeof createFakeAdmin>, organizationId = ORG_A): McpAuthContext {
  return {
    keyId: "key-1",
    organizationId,
    userId: "user-1",
    admin: admin as unknown as McpAuthContext["admin"],
  };
}

function baseTables(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    projects: [
      { id: PROJECT_1, name: "Alpha", github_repo: "acme/alpha", organization_id: ORG_A, created_at: "2026-01-01" },
    ],
    production_verdicts: [],
    repository_scan_state: [],
    // A healthy, connected repository with no push detected yet since
    // connecting — this is the "current" default. Tests that need to
    // exercise stale/unknown freshness override this explicitly.
    github_webhooks: [
      { project_id: PROJECT_1, active: true, callback_url: null, last_delivery_at: "2026-01-01T00:00:00.000Z" },
    ],
    repository_sync_status: [
      { project_id: PROJECT_1, commit_sha: null, connection_status: "connected", last_error: null },
    ],
    scan_findings: [],
    scans: [],
    profiles: [],
    ...overrides,
  };
}

const t = getMcpTranslator("en");

describe("can_i_deploy", () => {
  it("returns a full production review for the resolved project", async () => {
    const verdict = buildVerdictFixture({ status: "not_ready", score: 64, blockersCount: 2 });
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);

    expect(result.verdictStatus).toBe("not_ready");
    expect(result.score).toBe(64);
    expect(result.blockersCount).toBe(2);
    expect(result.topBlockers).toHaveLength(2);
    expect(result.deploymentRecommendation).toBe("DO_NOT_DEPLOY");
    expect(result.summary).toContain("SEQURAI");
    expect(result.summary).toContain("DEPLOY ANSWER");
    expect(result.summary).toContain("What worries me most:");
    expect(result.summary).not.toContain("Production Ready Score:");
  });

  it("includes the deployment recommendation and the fields migrated from the retired deployment_confidence tool", async () => {
    const verdict = buildVerdictFixture({
      status: "ready_to_ship",
      score: 96,
      blockersCount: 0,
      topPriorities: [],
      confidence: "low",
      scanId: "44444444-4444-4444-8444-444444444441",
      commitSha: "ready111",
    });
    const tables = baseTables({
      production_verdicts: [verdictRow(PROJECT_1, verdict)],
      scans: [
        {
          id: "44444444-4444-4444-8444-444444444441",
          repository_id: PROJECT_1,
          status: "completed",
          commit_sha: "ready111",
          created_at: "2026-03-01",
        },
      ],
    });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);

    expect(result.deploymentRecommendation).toBe("SHIP_IT");
    // Reuses the verdict engine's own confidence field rather than inventing one.
    expect(result.confidenceBand).toBe("low");
    expect(result.latestReviewId).toBe("44444444-4444-4444-8444-444444444441");
    expect(result.latestReviewStatus).toBe("completed");
  });

  it("never coerces a null score to zero", async () => {
    const verdict = buildVerdictFixture({
      status: "insufficient_data",
      score: null,
      blockersCount: 0,
      topPriorities: [],
    });
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);

    expect(result.score).toBeNull();
    expect(result.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    expect(result.summary).toContain(t("canIDeploy.cantAnswerLead"));
  });

  it("caps topBlockers at 3 even if more priorities exist", async () => {
    const verdict = buildVerdictFixture();
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.topBlockers.length).toBeLessThanOrEqual(3);
  });

  it("reports analysis_failed clearly", async () => {
    const verdict = buildVerdictFixture({ status: "analysis_failed", score: null, topPriorities: [] });
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.summary).toContain(t("canIDeploy.analysisFailed"));
  });

  it("flags a stale verdict when the repository has a newer detected commit", async () => {
    const verdict = buildVerdictFixture({ commitSha: "aaa1111" });
    const tables = baseTables({
      production_verdicts: [verdictRow(PROJECT_1, verdict)],
      repository_sync_status: [
        { project_id: PROJECT_1, commit_sha: "bbb2222", connection_status: "connected", last_error: null },
      ],
    });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.stale).toBe(true);
    expect(result.freshnessStatus).toBe("stale");
    expect(result.latestDetectedCommitSha).toBe("bbb2222");
    expect(result.summary).toContain("bbb2222");
  });

  it("flags reviewInProgress when a scan is currently active", async () => {
    const verdict = buildVerdictFixture({ commitSha: "aaa1111" });
    const tables = baseTables({
      production_verdicts: [verdictRow(PROJECT_1, verdict)],
      repository_sync_status: [
        { project_id: PROJECT_1, commit_sha: "aaa1111", connection_status: "connected", last_error: null },
      ],
      repository_scan_state: [{ repository_id: PROJECT_1, last_commit_sha: "aaa1111", active_scan_id: "scan-99" }],
      scans: [
        {
          id: "scan-99",
          repository_id: PROJECT_1,
          status: "scanning",
          commit_sha: "bbb2222",
          created_at: "2026-03-02",
        },
      ],
    });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.reviewInProgress).toBe(true);
    expect(result.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    expect(result.summary).not.toContain("YES.");
    expect(result.summary).not.toContain("NO.");
  });

  it("reports freshnessStatus unknown — never 'current' — when push detection has no proof of working", async () => {
    // Real-world regression: a webhook exists and is marked active, but it
    // was registered against an unreachable callback URL (or has otherwise
    // never delivered), so repository_sync_status was never populated even
    // though newer commits exist upstream. The system must not invent that
    // the verdict is current just because it has no signal either way.
    const verdict = buildVerdictFixture({ commitSha: "aaa1111" });
    const tables = baseTables({
      production_verdicts: [verdictRow(PROJECT_1, verdict)],
      github_webhooks: [],
      repository_sync_status: [],
    });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.freshnessStatus).toBe("unknown");
    expect(result.stale).toBe(true);
    expect(result.summary).toContain(t("canIDeploy.freshnessUnknown"));
  });

  it("reports a failed automatic review as stale, not merely unknown", async () => {
    const verdict = buildVerdictFixture({ commitSha: "aaa1111" });
    const tables = baseTables({
      production_verdicts: [verdictRow(PROJECT_1, verdict)],
      repository_sync_status: [
        { project_id: PROJECT_1, commit_sha: "aaa1111", connection_status: "connected", last_error: null },
      ],
      scans: [
        {
          repository_id: PROJECT_1,
          review_type: "automatic",
          status: "failed",
          commit_sha: "ccc3333",
          created_at: "2026-02-01",
        },
      ],
    });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.reviewFailed).toBe(true);
    expect(result.freshnessStatus).toBe("stale");
    expect(result.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    expect(result.summary).toContain("did not complete successfully");
  });

  it("maps ready_to_ship to SHIP_IT", async () => {
    const verdict = buildVerdictFixture({ status: "ready_to_ship", score: 96, blockersCount: 0, topPriorities: [] });
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.deploymentRecommendation).toBe("SHIP_IT");
  });

  it.each(["almost_ready", "needs_improvement", "not_ready"] as const)(
    "maps %s to DO_NOT_DEPLOY",
    async (status) => {
      const verdict = buildVerdictFixture({ status, score: 60 });
      const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
      const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
      expect(result.deploymentRecommendation).toBe("DO_NOT_DEPLOY");
    }
  );

  it.each(["insufficient_data", "analysis_failed"] as const)(
    "maps %s to MORE_ANALYSIS_REQUIRED",
    async (status) => {
      const verdict = buildVerdictFixture({ status, score: null, topPriorities: [] });
      const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
      const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
      expect(result.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    }
  );

  it("throws no_verdict_available when the project has never been reviewed", async () => {
    const tables = baseTables();
    await expect(canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t)).rejects.toMatchObject({
      code: "no_verdict_available",
    });
  });

  it("throws project_not_found for a project outside the caller's organization", async () => {
    const tables = baseTables();
    await expect(
      canIDeploy(ctxFor(createFakeAdmin(tables)), { projectId: "does-not-exist" }, t)
    ).rejects.toMatchObject({ code: "project_not_found" });
  });

  it("enforces tenant isolation: cannot access a project from another organization", async () => {
    const tables = baseTables();
    await expect(
      canIDeploy(ctxFor(createFakeAdmin(tables), ORG_B), { projectId: PROJECT_1 }, t)
    ).rejects.toMatchObject({ code: "project_not_found" });
  });

  it("returns ambiguous_project with a project list when multiple projects exist and none is specified", async () => {
    const tables = baseTables({
      projects: [
        { id: PROJECT_1, name: "Alpha", github_repo: "acme/alpha", organization_id: ORG_A, created_at: "2026-01-01" },
        { id: PROJECT_2, name: "Beta", github_repo: "acme/beta", organization_id: ORG_A, created_at: "2026-01-02" },
      ],
    });
    try {
      await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
      throw new Error("expected ambiguous_project to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe("ambiguous_project");
      expect(mcpError.data?.projects).toHaveLength(2);
    }
  });

  it("auto-selects the single project when the organization has exactly one", async () => {
    const verdict = buildVerdictFixture();
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.project.id).toBe(PROJECT_1);
  });

  it("responds in Spanish when locale=es is requested", async () => {
    const verdict = buildVerdictFixture();
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const es = getMcpTranslator("es");
    const result = await canIDeploy(ctxFor(createFakeAdmin(tables)), {}, es);
    expect(result.summary).toContain("SEQURAI");
    expect(result.summary).toContain(es("modes.production_review"));
  });
});

describe("safe_fix", () => {
  it("returns a blocker list (max 5) when no blocker is specified", async () => {
    const verdict = buildVerdictFixture();
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await safeFix(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.status).toBe("choose_blocker");
    if (result.status === "choose_blocker") {
      expect(result.blockers.length).toBeLessThanOrEqual(5);
      expect(result.blockers.length).toBeGreaterThan(0);
    }
  });

  it("reports no_blockers when the verdict has none", async () => {
    const verdict = buildVerdictFixture({ blockersCount: 0, topPriorities: [] });
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await safeFix(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.status).toBe("no_blockers");
  });

  it("generates a Safe Fix Prompt for a chosen blocker with risk, time, and projected verdict", async () => {
    const verdict = buildVerdictFixture();
    const tables = baseTables({
      production_verdicts: [verdictRow(PROJECT_1, verdict)],
      scans: [{ id: verdict.scanId, detected_stack: null }],
    });
    const result = await safeFix(ctxFor(createFakeAdmin(tables)), { blockerId: "priority-1" }, t);
    expect(result.status).toBe("prompt_ready");
    if (result.status === "prompt_ready") {
      expect(result.safeFixPrompt.length).toBeGreaterThan(0);
      expect(["LOW", "MEDIUM", "HIGH"]).toContain(result.implementationRisk);
      expect(result.estimatedFixTime.length).toBeGreaterThan(0);
      expect(typeof result.projectedScore).toBe("number");
      expect(result.summary).toContain("FIX FOR CURSOR");
    }
  });

  it("throws blocker_not_found for an unknown blocker id", async () => {
    const verdict = buildVerdictFixture();
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    await expect(
      safeFix(ctxFor(createFakeAdmin(tables)), { blockerId: "does-not-exist" }, t)
    ).rejects.toMatchObject({ code: "blocker_not_found" });
  });

  it("accepts priorityId and findingId as aliases for blockerId", async () => {
    const verdict = buildVerdictFixture();
    const tables = baseTables({
      production_verdicts: [verdictRow(PROJECT_1, verdict)],
      scans: [{ id: verdict.scanId, detected_stack: null }],
    });
    const byFindingId = await safeFix(ctxFor(createFakeAdmin(tables)), { findingId: "finding-1" }, t);
    expect(byFindingId.status).toBe("prompt_ready");
  });
});

describe("what_changed", () => {
  it("distinguishes resolved blockers from detected blockers and never claims confirmed causality", async () => {
    const previous = buildVerdictFixture({
      score: 58,
      status: "needs_improvement",
      topPriorities: [
        {
          id: "priority-old",
          rank: 1,
          title: "Exposed service-role key",
          category: "security",
          reason: "Key committed to source.",
          severity: "critical",
          confidence: "high",
          estimatedMinutes: 5,
          estimatedTimeLabel: "5 minutes",
          projectedScoreImpact: 10,
          affectedFiles: [],
          recommendedAction: "Rotate the key.",
          findingIds: ["f-old"],
        },
      ],
      generatedAt: new Date(2026, 0, 1).toISOString(),
    });
    const current = buildVerdictFixture({
      score: 78,
      status: "almost_ready",
      scoreDelta: 20,
      topPriorities: [
        {
          id: "priority-new",
          rank: 1,
          title: "Missing rate limiting",
          category: "availability",
          reason: "No throttling on the public API.",
          severity: "high",
          confidence: "medium",
          estimatedMinutes: 10,
          estimatedTimeLabel: "10 minutes",
          projectedScoreImpact: 6,
          affectedFiles: [],
          recommendedAction: "Add rate limiting.",
          findingIds: ["f-new"],
        },
      ],
      generatedAt: new Date(2026, 0, 2).toISOString(),
    });

    const tables = baseTables({
      production_verdicts: [verdictRow(PROJECT_1, previous), verdictRow(PROJECT_1, current)],
    });

    const result = await whatChanged(ctxFor(createFakeAdmin(tables)), {}, t);

    expect(result.resolvedBlockers).toEqual(["Exposed service-role key"]);
    expect(result.detectedBlockers).toEqual(["Missing rate limiting"]);
    expect(result.confirmedIntroducedBlockers).toEqual([]);
    expect(result.scoreDelta).toBe(20);
    expect(result.summary).toContain(t("whatChanged.worriesNowHeader"));
    expect(result.summary).not.toContain("introduced by your latest change");
  });

  it("reports there is nothing to compare on the first valid review", async () => {
    const verdict = buildVerdictFixture();
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await whatChanged(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.previousScore).toBeNull();
    expect(result.summary).toContain(t("whatChanged.noPreviousReview"));
  });

  it("skips invalid (analysis_failed / insufficient_data) verdicts when computing the diff", async () => {
    const valid1 = buildVerdictFixture({
      score: 50,
      status: "needs_improvement",
      generatedAt: new Date(2026, 0, 1).toISOString(),
    });
    const failed = buildVerdictFixture({
      score: null,
      status: "analysis_failed",
      topPriorities: [],
      generatedAt: new Date(2026, 0, 2).toISOString(),
    });
    const valid2 = buildVerdictFixture({
      score: 70,
      status: "almost_ready",
      generatedAt: new Date(2026, 0, 3).toISOString(),
    });

    const tables = baseTables({
      production_verdicts: [
        verdictRow(PROJECT_1, valid1),
        verdictRow(PROJECT_1, failed),
        verdictRow(PROJECT_1, valid2),
      ],
    });

    const result = await whatChanged(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.previousScore).toBe(50);
    expect(result.currentScore).toBe(70);
  });

  it("throws no_verdict_available when there is no valid review yet", async () => {
    const tables = baseTables();
    await expect(whatChanged(ctxFor(createFakeAdmin(tables)), {}, t)).rejects.toMatchObject({
      code: "no_verdict_available",
    });
  });
});

describe("production_history", () => {
  it("returns a concise, bounded recent-score timeline", async () => {
    const verdicts = Array.from({ length: 10 }, (_, i) =>
      buildVerdictFixture({ score: 50 + i, generatedAt: new Date(2026, 0, 1 + i).toISOString() })
    );
    const tables = baseTables({
      production_verdicts: verdicts.map((v) => verdictRow(PROJECT_1, v)),
    });
    const result = await productionHistory(ctxFor(createFakeAdmin(tables)), { limit: 3 }, t);
    expect(result.recentVerdicts.length).toBeLessThanOrEqual(3);
    expect(result.currentScore).toBe(59);
    expect(result.bestScore).toBe(59);
  });

  it("clamps limit to the safe maximum", async () => {
    const verdicts = Array.from({ length: 30 }, (_, i) =>
      buildVerdictFixture({ score: 50, generatedAt: new Date(2026, 0, 1 + i).toISOString() })
    );
    const tables = baseTables({
      production_verdicts: verdicts.map((v) => verdictRow(PROJECT_1, v)),
    });
    const result = await productionHistory(ctxFor(createFakeAdmin(tables)), { limit: 999 }, t);
    expect(result.recentVerdicts.length).toBeLessThanOrEqual(20);
  });

  it("returns a concise empty state (not an error) when there is no history yet", async () => {
    const tables = baseTables();
    const result = await productionHistory(ctxFor(createFakeAdmin(tables)), {}, t);
    expect(result.totalValidReviews).toBe(0);
    expect(result.currentScore).toBeNull();
    expect(result.trend).toBe("insufficient_data");
  });

  it("never presents a null score as zero", async () => {
    const verdict = buildVerdictFixture({ score: null, status: "insufficient_data", topPriorities: [] });
    const tables = baseTables({ production_verdicts: [verdictRow(PROJECT_1, verdict)] });
    const result = await productionHistory(ctxFor(createFakeAdmin(tables)), {}, t);
    // insufficient_data/null-score verdicts are excluded from valid history
    expect(result.currentScore).toBeNull();
  });
});

// deployment_confidence was retired (MCP V1 — Remote Production Review):
// its unique output (confidenceBand) was migrated into can_i_deploy above,
// and its deploy/do-not-deploy/more-analysis-required mapping is exercised
// directly through can_i_deploy's deploymentRecommendation in the
// describe("can_i_deploy") block. See server/mcp/tools/review-now.ts and
// docs/MCP_REVIEW_NOW_REPORT.md.
