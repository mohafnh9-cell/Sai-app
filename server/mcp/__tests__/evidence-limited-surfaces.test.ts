import { describe, expect, it } from "vitest";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { formatGithubCheckDescription, formatGithubCheckSummary } from "@/brain/production-verdict/adapters/format";
import { heroViewFromVerdict } from "@/brain/production-verdict/hero-view";
import { containsApprovalLanguage } from "@/brain/production-verdict/narrative-guard";
import { githubDecisionPresentation, commitStatusStateFor } from "@/server/github-automation/github-check-run";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { formatFullProductAuditResponse } from "@/server/full-product-audit/format-response";
import { buildRecommendation } from "@/server/full-product-audit/orchestrate";
import { verdictAffirmsDeploy } from "@/brain/production-verdict/deployment-posture";
import { canIDeploy } from "@/server/mcp/tools/can-i-deploy";
import { createFakeAdmin } from "./fake-admin";
import { buildVerdictFixture, verdictRow } from "./verdict-fixture";
import { testMcpAuthContext } from "./test-context";

const P = "11111111-1111-4111-8111-111111111111";
const area = (key: string) => ({
  key, label: key, score: null, status: "not_evaluated", confidence: "low",
  limitations: "n/a", methodology: "static", evidenceCount: 0,
});

async function surfaces(overrides: Record<string, unknown>) {
  const verdict = buildVerdictFixture({
    status: "ready_to_ship", score: 100, blockersCount: 0, topPriorities: [],
    ...overrides,
  } as never);
  const admin = createFakeAdmin({
    projects: [{ id: P, name: "A", github_repo: "a/b", organization_id: "org-a", created_at: "2026-01-01" }],
    production_verdicts: [verdictRow(P, verdict)],
    repository_scan_state: [], scan_findings: [], scans: [], profiles: [],
    github_webhooks: [{ project_id: P, active: true, callback_url: null, last_delivery_at: "2026-01-01T00:00:00.000Z" }],
    repository_sync_status: [{ project_id: P, commit_sha: null, connection_status: "connected", last_error: null }],
  } as never);
  const stored = (await getCurrentProductionVerdict(admin as never, "org-a", P))!;
  const mcp = await canIDeploy(testMcpAuthContext(admin as never, { organizationId: "org-a" }), {}, getMcpTranslator("en"));
  return { stored, mcp };
}

describe("evidence-limited ready verdict across customer surfaces", () => {
  const limited = {
    confidence: "medium",
    unevaluatedAreas: ["testing", "performance", "observability", "reliability"].map(area),
    executiveSummary:
      "No blockers found in the evidence analyzed. Production Ready Score is 100/100. Evidence confidence is medium, so this is not a deployment approval. 4 areas are not fully evaluated.",
    recommendedAction:
      "No blockers were found, but evidence is limited. Review the Production Verdict coverage and close the gaps before relying on it.",
  };

  it("no surface uses approval wording", async () => {
    const { stored, mcp } = await surfaces(limited);
    const hero = heroViewFromVerdict(stored);
    const gh = githubDecisionPresentation(stored);
    const texts = [
      stored.executiveSummary, stored.recommendedAction,
      hero.headline, hero.subheadline,
      mcp.summary, mcp.nextAction,
      formatGithubCheckSummary({ verdict: stored }), formatGithubCheckDescription(stored),
      gh.title, gh.label,
    ];
    for (const t of texts) expect(containsApprovalLanguage(t), t).toBe(false);
    expect(hero.headline).not.toMatch(/READY TO SHIP/);
    expect(formatGithubCheckSummary({ verdict: stored })).not.toMatch(/Ready to Ship/);
    expect(formatGithubCheckDescription(stored)).not.toMatch(/Ready to Ship/);
    expect(mcp.summary).toMatch(/not a guarantee|not a deployment approval/);
    expect(gh.conclusion).toBe("neutral");
    expect(commitStatusStateFor(gh, stored.status, "passed")).toBe("pending");
  });

  it("Full Product Audit (MCP) shows the same evidence-limited posture: no READY TO SHIP headline, consistent recommendation", async () => {
    const { stored } = await surfaces(limited);
    const affirmsDeploy = verdictAffirmsDeploy(stored);
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, confirmed: 0, likely: 0, potential: 0, notReproduced: 0, falsePositive: 0, notApplicable: 0 };
    const result = {
      mode: "full_product_audit", phase: "complete", project: { id: P, name: "A", repositoryFullName: null }, reviewId: stored.scanId, commitSha: stored.commitSha,
      verdictStatus: stored.status, affirmsDeploy, score: stored.score, counts, topRisks: [], whatToFixFirst: [], findings: [],
      engines: { codeReview: { scanId: stored.scanId, findingsCount: 0, rulesRun: 1 }, securityTesting: { campaignId: null, executionsRun: 0, executionsCompleted: 0, adaptersExecuted: [], adaptersSelectedFromFindings: [], runtimeMode: "mock", dynamicTargetSource: "none", skippedReason: null, notSafelyTestableCount: 0 } },
      dynamicVerification: { offered: false, decision: null, authorizedTarget: null, awaitingUrl: false, awaitingAuthorization: false, awaitingScopeApproval: false, notSafelyTestableCount: 0 },
      safeFixAvailable: false, safeFixBlockerId: null,
      recommendation: buildRecommendation({ verdictStatus: stored.status, affirmsDeploy, topRisks: [], counts }),
      summary: "", timedOut: false, nextAction: "n",
    } as never;
    const audit = formatFullProductAuditResponse(result, getMcpTranslator("en"));
    expect(audit.summary).not.toContain("READY TO SHIP");
    expect(audit.summary).toContain("EVIDENCE LIMITED");
    expect(containsApprovalLanguage(audit.summary), audit.summary).toBe(false);
  });

  it("legacy stored approval text is neutralised at read time (stored text is not the only guard)", async () => {
    const { mcp, stored } = await surfaces({
      ...limited,
      executiveSummary: "Ready to Ship. Production Ready Score is 100/100. No production blockers detected. Your application meets the current readiness threshold.",
      recommendedAction: "Deploy when your release process is ready. SequrAI will review every subsequent push.",
    });
    expect(mcp.summary).not.toMatch(/meets the current readiness threshold/);
    const hero = heroViewFromVerdict(stored);
    expect(hero.headline).toBe("NO BLOCKERS FOUND — EVIDENCE LIMITED");
  });

  it("high confidence with full coverage keeps the approval presentation everywhere", async () => {
    const { stored } = await surfaces({ confidence: "high", unevaluatedAreas: [], partiallyEvaluatedAreas: [] });
    expect(heroViewFromVerdict(stored).headline).toBe("READY TO SHIP");
    expect(formatGithubCheckSummary({ verdict: stored })).toMatch(/Ready to Ship/);
    const gh = githubDecisionPresentation(stored);
    expect(commitStatusStateFor(gh, stored.status, "passed")).toBe("success");
  });
});
