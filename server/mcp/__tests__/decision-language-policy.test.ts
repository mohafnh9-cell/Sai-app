import { describe, expect, it } from "vitest";
import type { McpAuthContext } from "@/server/mcp/auth";
import type { ProductionVerdictV1, VerdictStatus } from "@/brain/production-verdict/schema";
import {
  containsApprovalLanguage,
  deriveDecisionLanguagePolicy,
  describeCoverage,
  guardDecisionText,
  type PolicyInput,
} from "@/server/mcp/decision-language-policy";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { formatCanIDeployResponse } from "@/server/mcp/personality";
import { canIDeploy } from "@/server/mcp/tools/can-i-deploy";
import { safeFix } from "@/server/mcp/tools/safe-fix";
import { whatChanged } from "@/server/mcp/tools/what-changed";
import { productionHistory } from "@/server/mcp/tools/production-history";
import { enrichMcpToolResultWithAlerts } from "@/server/security-alerts/mcp-enrichment";
import { createFakeAdmin, type FakeTables } from "./fake-admin";
import { testMcpAuthContext } from "./test-context";
import { buildVerdictFixture, verdictRow } from "./verdict-fixture";

const ORG = "org-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const SCAN = "44444444-4444-4444-8444-444444444441";
const en = getMcpTranslator("en");
const es = getMcpTranslator("es");

const SPANISH = /\b(SÍ|NO SE|Despliega|cómodo|desplegar|revisión|Espera|Revisa)\b/i;

const KEYS = ["security", "authentication", "authorization", "data_protection", "dependencies", "architecture", "testing", "performance"];
function area(name: string) {
  const key = KEYS[name.charCodeAt(0) - 97];
  return { key, label: key, status: "not_evaluated", score: null, confidence: "low", evidenceCount: 0, methodology: "m", limitations: "l" } as never;
}

function tables(verdict: ProductionVerdictV1, opts: { fresh?: boolean } = {}): FakeTables {
  const row = verdictRow(PROJECT, verdict);
  return {
    projects: [{ id: PROJECT, name: "Alpha", github_repo: "acme/alpha", organization_id: ORG, created_at: "2026-01-01" }],
    production_verdicts: [row],
    repository_scan_state: [{ repository_id: PROJECT, current_verdict_id: row.id }],
    github_webhooks: [{ project_id: PROJECT, active: true, callback_url: null, last_delivery_at: "2026-01-01T00:00:00.000Z" }],
    repository_sync_status: [
      { project_id: PROJECT, commit_sha: opts.fresh === false ? "newer999" : null, connection_status: "connected", last_error: null },
    ],
    scans: [
      {
        id: verdict.scanId,
        project_id: PROJECT,
        repository_id: PROJECT,
        status: "completed",
        commit_sha: verdict.commitSha,
        branch: "main",
        security_score: verdict.score,
        files_analyzed: 50,
        files_discovered: 50,
        completed_at: "2026-03-01T00:00:00.000Z",
        created_at: "2026-03-01",
      },
    ],
    scan_findings: [],
    profiles: [],
  } as FakeTables;
}

function ctx(admin: ReturnType<typeof createFakeAdmin>): McpAuthContext {
  return testMcpAuthContext(admin, { organizationId: ORG });
}

const READY = (over: Partial<ProductionVerdictV1> = {}) =>
  buildVerdictFixture({
    status: "ready_to_ship",
    score: 100,
    blockersCount: 0,
    criticalBlockersCount: 0,
    highBlockersCount: 0,
    topPriorities: [],
    scanId: SCAN,
    commitSha: "ready111",
    coverageRatio: 1,
    ...over,
  });

const SAFE_TEXT = /safe to (deploy|ship)|security decision: (safe|deploy)|i would (ship|deploy)|i'd (ship|deploy)|(?<!\b(?:not|n't)\s+(?:fully\s+)?)comfortable (with you )?(shipping|deploying|protecting)|deploy with confidence|fully secure|proven secure|fully analy[sz]ed|(?<!\bno\s+)me siento cómodo|desplegaría esto|puedes desplegar/i;

function expectNoApproval(text: string) {
  expect(text).not.toMatch(SAFE_TEXT);
  expect(containsApprovalLanguage(text)).toBe(false);
}

const base: PolicyInput = {
  status: "ready_to_ship",
  confidence: "high",
  unevaluatedAreaCount: 0,
  partiallyEvaluatedAreaCount: 0,
  baseDecision: "deploy",
  freshnessStatus: "current",
  reviewInProgress: false,
  reviewFailed: false,
};

describe("decision language policy matrix", () => {
  const cases: Array<[string, Partial<PolicyInput>, string, boolean]> = [
    ["insufficient_data", { status: "insufficient_data", baseDecision: "more_analysis_required", confidence: "low" }, "INSUFFICIENT", false],
    ["analysis_failed", { status: "analysis_failed", baseDecision: "more_analysis_required", confidence: "low" }, "INSUFFICIENT", false],
    ["not_ready + low", { status: "not_ready", baseDecision: "do_not_deploy", confidence: "low" }, "BLOCKED", false],
    ["not_ready + medium", { status: "not_ready", baseDecision: "do_not_deploy", confidence: "medium" }, "BLOCKED", false],
    ["not_ready + high", { status: "not_ready", baseDecision: "do_not_deploy", confidence: "high" }, "BLOCKED", false],
    ["almost_ready + low", { status: "almost_ready", baseDecision: "do_not_deploy", confidence: "low" }, "BLOCKED", false],
    ["needs_improvement + high", { status: "needs_improvement", baseDecision: "do_not_deploy" }, "BLOCKED", false],
    ["ready + low", { confidence: "low" }, "QUALIFIED", false],
    ["ready + medium", { confidence: "medium" }, "SUPPORTED", true],
    ["ready + high", {}, "HIGH_CONFIDENCE", true],
    ["ready + high + unevaluated areas", { unevaluatedAreaCount: 4 }, "SUPPORTED", true],
    ["ready + high + partial areas", { partiallyEvaluatedAreaCount: 1 }, "SUPPORTED", true],
    ["ready + stale", { freshnessStatus: "stale" }, "INSUFFICIENT", false],
    ["ready + freshness unknown", { freshnessStatus: "unknown" }, "INSUFFICIENT", false],
    ["ready + review in progress", { reviewInProgress: true }, "INSUFFICIENT", false],
    ["ready + review failed", { reviewFailed: true }, "INSUFFICIENT", false],
    ["ready + engine says more analysis (incomplete evidence)", { baseDecision: "more_analysis_required" }, "INSUFFICIENT", false],
  ];

  it.each(cases)("%s -> %s", (_name, over, strength, mayDeploy) => {
    const policy = deriveDecisionLanguagePolicy({ ...base, ...over });
    expect(policy.strength).toBe(strength);
    expect(policy.mayRecommendDeploy).toBe(mayDeploy);
    // Deployment approval / first-person / "safe to deploy" are HIGH_CONFIDENCE only.
    expect(policy.canUseSafeToDeployLanguage).toBe(strength === "HIGH_CONFIDENCE");
    expect(policy.canUseFirstPersonDeploymentLanguage).toBe(strength === "HIGH_CONFIDENCE");
    expect(policy.canUseVerifiedLanguage).toBe(false);
    expect(policy.decision === "deploy").toBe(mayDeploy);
  });

  it("is monotone: weakening evidence can never strengthen the strength", () => {
    const order = ["INSUFFICIENT", "BLOCKED", "QUALIFIED", "SUPPORTED", "HIGH_CONFIDENCE"];
    const rank = (o: Partial<PolicyInput>) => order.indexOf(deriveDecisionLanguagePolicy({ ...base, ...o }).strength);
    expect(rank({ confidence: "low" })).toBeLessThanOrEqual(rank({ confidence: "medium" }));
    expect(rank({ confidence: "medium" })).toBeLessThanOrEqual(rank({}));
    expect(rank({ unevaluatedAreaCount: 1 })).toBeLessThanOrEqual(rank({}));
    expect(rank({ freshnessStatus: "stale" })).toBeLessThanOrEqual(rank({}));
  });
});

describe("phrase guard", () => {
  it.each([
    "Safe to deploy based on current authorized security evidence.",
    "Security Decision: Safe to deploy.",
    "I would deploy this",
    "I'd ship it",
    "I'm comfortable with you shipping this.",
    "deploy with confidence",
    "This is fully secure",
    "proven secure",
    "Me siento cómodo con que despliegues esto.",
    "Si fuera mi empresa, desplegaría esto.",
    "Puedes desplegar",
  ])("detects %s", (text) => {
    expect(containsApprovalLanguage(text)).toBe(true);
  });

  it.each([
    "I'm not comfortable protecting this in production yet.",
    "I would not deploy this application.",
    "If this were my company, I would not ship until we fix what's below.",
  ])("does not flag honest negatives: %s", (text) => {
    expect(containsApprovalLanguage(text)).toBe(false);
  });

  it("drops approval text unless the policy is HIGH_CONFIDENCE", () => {
    const low = deriveDecisionLanguagePolicy({ ...base, confidence: "low" });
    const high = deriveDecisionLanguagePolicy(base);
    expect(guardDecisionText("Safe to deploy", low, "x")).toBe("x");
    expect(guardDecisionText("Safe to deploy", high, "x")).toBe("Safe to deploy");
  });
});

describe("coverage cannot read as complete while areas remain", () => {
  it("caps ratio and clears `complete` when unevaluated areas exist", () => {
    const v = READY({ unevaluatedAreas: [area("a"), area("b")], evaluatedAreas: [area("c"), area("d")] });
    const cov = describeCoverage(v);
    expect(cov.fileCoverageRatio).toBe(1);
    expect(cov.ratio).toBeLessThan(1);
    expect(cov.complete).toBe(false);
  });

  it("is complete only when files and areas are all complete", () => {
    const cov = describeCoverage(READY({ evaluatedAreas: [area("c")] }));
    expect(cov.ratio).toBe(1);
    expect(cov.complete).toBe(true);
  });
});

describe("NEW-2 through the real can_i_deploy path", () => {
  it("ready_to_ship + low confidence + unevaluated areas: no approval language, no SHIP_IT, no full coverage", async () => {
    const verdict = READY({
      confidence: "low",
      executiveSummary: "Safe to deploy based on current authorized security evidence.",
      unevaluatedAreas: [area("a"), area("b"), area("c"), area("d")],
      evaluatedAreas: [area("e"), area("f")],
      securityDecisionId: "55555555-5555-4555-8555-555555555555",
      securityDeploymentVerdict: "SAFE_TO_DEPLOY",
    });
    const result = await canIDeploy(ctx(createFakeAdmin(tables(verdict))), {}, en);

    expect(result.verdictStatus).toBe("ready_to_ship");
    expect(result.confidenceBand).toBe("low");
    expect(result.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    expectNoApproval(result.summary);
    expect(result.summary).not.toMatch(/SHIP IT/);
    expect(result.summary).toMatch(/confidence is low/i);
    expect(result.summary).not.toMatch(SPANISH);
    expect(result.evaluatedCoverage.complete).toBe(false);
    expect(result.evaluatedCoverage.ratio).toBeLessThan(1);
    expect(result.evaluatedCoverage.unevaluatedAreas).toBe(4);
  });

  it("AI overlay cannot promote or word an approval when the policy forbids it (any confidence-limited state)", async () => {
    for (const over of [
      { confidence: "low" as const },
      { confidence: "high" as const, unevaluatedAreas: [area("a")] },
    ]) {
      const verdict = READY({
        ...over,
        executiveSummary: "Security Decision: Safe to deploy. I would ship this.",
        securityDecisionId: "55555555-5555-4555-8555-555555555555",
        securityDeploymentVerdict: "SAFE_TO_DEPLOY",
      });
      const result = await canIDeploy(ctx(createFakeAdmin(tables(verdict))), {}, en);
      expectNoApproval(result.summary);
      if (over.confidence === "low") expect(result.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
      else expect(result.deploymentRecommendation).toBe("SHIP_IT");
    }
  });

  it("HIGH_CONFIDENCE (high, all areas evaluated, current) may still use approval language", async () => {
    const verdict = READY({ evaluatedAreas: [area("a")] });
    const result = await canIDeploy(ctx(createFakeAdmin(tables(verdict))), {}, en);
    expect(result.deploymentRecommendation).toBe("SHIP_IT");
    expect(result.summary).toContain("YES.");
    expect(result.evaluatedCoverage.complete).toBe(true);
  });

  it("SUPPORTED (medium/high with unevaluated areas): qualified, discloses the gap, no first-person approval", async () => {
    const verdict = READY({ unevaluatedAreas: [area("a"), area("b")] });
    const result = await canIDeploy(ctx(createFakeAdmin(tables(verdict))), {}, en);
    expect(result.deploymentRecommendation).toBe("SHIP_IT");
    expectNoApproval(result.summary);
    expect(result.summary).toMatch(/2 area\(s\) were not fully evaluated/);
    expect(result.summary).not.toMatch(/nothing (critical )?is blocking/i);
  });

  it("no findings + insufficient evidence never reads as safe", async () => {
    const verdict = READY({ status: "insufficient_data", score: null, confidence: "low", executiveSummary: "Safe to deploy. No findings." });
    const result = await canIDeploy(ctx(createFakeAdmin(tables(verdict))), {}, en);
    expect(result.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    expectNoApproval(result.summary);
  });

  it("no findings + low-confidence ready is 'not detected', not proven", async () => {
    const result = await canIDeploy(ctx(createFakeAdmin(tables(READY({ confidence: "low" })))), {}, en);
    expect(result.blockersCount).toBe(0);
    expect(result.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
    expectNoApproval(result.summary);
  });

  it("stale evidence never yields approval language", async () => {
    const result = await canIDeploy(ctx(createFakeAdmin(tables(READY({ evaluatedAreas: [area("a")] }), { fresh: false }))), {}, en);
    expect(result.deploymentRecommendation).not.toBe("SHIP_IT");
    expectNoApproval(result.summary);
  });

  it("do-not-deploy verdicts drop persisted 'Safe to deploy' narratives", async () => {
    const verdict = buildVerdictFixture({
      status: "not_ready",
      executiveSummary: "Safe to deploy based on current authorized security evidence.",
      scanId: SCAN,
      commitSha: "ready111",
    });
    const result = await canIDeploy(ctx(createFakeAdmin(tables(verdict))), {}, en);
    expect(result.deploymentRecommendation).toBe("DO_NOT_DEPLOY");
    expectNoApproval(result.summary);
  });

  it("alert layer adds no approval-flavoured lead", async () => {
    const admin = createFakeAdmin({ security_alerts: [] } as FakeTables);
    const enriched = await enrichMcpToolResultWithAlerts(admin as never, "can_i_deploy", {
      project: { id: PROJECT },
      summary: "NOT CONFIRMED YET.",
      verdictScanId: SCAN,
      deploymentRecommendation: "MORE_ANALYSIS_REQUIRED",
    });
    expectNoApproval(enriched.summary ?? "");
  });
});

describe("other decision tools follow the same canonical policy", () => {
  it("safe_fix / what_changed / production_history do not describe a low-confidence ready verdict as clean", async () => {
    const verdict = READY({ confidence: "low" });
    const admin = createFakeAdmin(tables(verdict));
    const sf = await safeFix(ctx(admin), {}, en);
    expect(JSON.stringify(sf)).not.toMatch(/"status":"no_blockers"/);
    const wc = await whatChanged(ctx(admin), {}, en);
    expectNoApproval(JSON.stringify(wc));
    const ph = await productionHistory(ctx(admin), {}, en);
    expectNoApproval(JSON.stringify(ph));
  });
});

describe("personality bypass", () => {
  it("formatter output contains no approval language for any non-HIGH_CONFIDENCE policy, even with hostile summaries", () => {
    const hostile = "Honestly, I'd ship it. Safe to deploy. Security Decision: Safe to deploy. Fully secure.";
    const statuses: VerdictStatus[] = ["ready_to_ship", "almost_ready", "not_ready", "needs_improvement", "insufficient_data", "analysis_failed"];
    const overs: Array<Partial<PolicyInput>> = [
      {}, { confidence: "low" }, { confidence: "medium" }, { unevaluatedAreaCount: 3 }, { freshnessStatus: "stale" }, { reviewFailed: true },
    ];
    for (const status of statuses) {
      for (const over of overs) {
        const baseDecision = status === "ready_to_ship" ? "deploy" : status === "insufficient_data" || status === "analysis_failed" ? "more_analysis_required" : "do_not_deploy";
        const policy = deriveDecisionLanguagePolicy({ ...base, status, baseDecision, ...over });
        if (policy.strength === "HIGH_CONFIDENCE") continue;
        for (const t of [en, es]) {
          const text = formatCanIDeployResponse(t, {
            policy,
            decision: policy.decision,
            status,
            executiveSummary: hostile,
            worries: [],
            blockersCount: 0,
            staleness: { reviewInProgress: false, freshnessStatus: "current", reviewFailed: false, latestDetectedCommitSha: null },
          });
          expect(containsApprovalLanguage(text), `${status} ${JSON.stringify(over)}\n${text}`).toBe(false);
        }
      }
    }
  });
});

describe("locale", () => {
  it("English response contains no Spanish decision text; Spanish response is Spanish", async () => {
    const verdict = READY({ confidence: "low" });
    const admin = createFakeAdmin(tables(verdict));
    const english = await canIDeploy(ctx(admin), {}, en);
    expect(english.summary).not.toMatch(SPANISH);
    expect(english.nextAction).not.toMatch(SPANISH);
    const spanish = await canIDeploy(ctx(admin), {}, es);
    expect(spanish.summary).toMatch(/AÚN NO CONFIRMADO|confianza es baja/);
    expect(spanish.nextAction).toMatch(/Revisa otra vez/);
    expectNoApproval(spanish.summary);
  });
});
