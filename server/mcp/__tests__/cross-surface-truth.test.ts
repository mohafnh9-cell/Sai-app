import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }));

import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { heroViewFromVerdict } from "@/brain/production-verdict/hero-view";
import { verdictExperienceFromVerdict } from "@/brain/production-verdict/experience-view";
import { canIDeployKey } from "@/brain/production-verdict/can-i-deploy-key";
import { deploymentPostureOf, verdictAffirmsDeploy } from "@/brain/production-verdict/deployment-posture";
import { protectionDecisionFor } from "@/brain/production-verdict/protection-decision";
import { verdictStatusHeadline, verdictStatusLabel, verdictStatusMessage } from "@/lib/i18n/verdict-copy";
import { buildProductionJourney } from "@/brain/production-journey/build";
import { journeyMaturityKey, journeyPostureKey } from "@/brain/production-journey/decision-display";
import { deploymentRecommendationText, mapVerdictDisplay } from "@/features/mission-control/lib/build-mission-control-view";
import { formatAnalysisRunStatusLabel } from "@/lib/i18n/analysis-run-status";
import { summaryFromVerdict } from "@/server/brain/build-org-brain";
import { pickPrimaryDashboardFocus } from "@/lib/dashboard/pick-primary-project";
import { ProductionControlCenter } from "@/features/dashboard/components/ProductionControlCenter";
import { commitStatusStateFor, githubDecisionPresentation } from "@/server/github-automation/github-check-run";
import { evaluateProtectionStatus } from "@/server/continuous-protection/status-machine";
import { canIDeploy } from "@/server/mcp/tools/can-i-deploy";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { createFakeAdmin } from "./fake-admin";
import { buildVerdictFixture, verdictRow } from "./verdict-fixture";
import { testMcpAuthContext } from "./test-context";

const P = "11111111-1111-4111-8111-111111111111";
const area = (key: string) => ({ key, label: key, score: null, status: "not_evaluated", confidence: "low", limitations: "n/a", methodology: "static", evidenceCount: 0 });

type Lang = "en" | "es";
const msg = (lang: Lang, ns: string) => JSON.parse(readFileSync(`messages/${lang}/${ns}.json`, "utf8")) as Record<string, unknown>;
function translator(lang: Lang) {
  return (key: string): string => {
    const [ns, ...path] = key.split(".");
    let node: unknown = msg(lang, ns);
    for (const part of path) node = (node as Record<string, unknown>)?.[part];
    if (typeof node !== "string") throw new Error(`missing i18n key ${lang}:${key}`);
    return node;
  };
}

/** Affirmative deployment language in any supported language. Negations ("not a deployment approval") do not count. */
const AFFIRMATIVE = /(^|[^a-záéíóú])(yes|sí|si)(\b|\.|\s|—)|listo para desplegar|ready to ship|ready for production|safe to deploy|segura\b|ship[_ ]it|green light|approved|puedes desplegar|production ready|production maintained|ready to deploy|lista para producci[oó]n|producci[oó]n mantenida/i;
/** Negations and the dashboard's question heading ("Ready to ship?") are not affirmations. */
const NEUTRAL = /not a deployment approval|no es una aprobaci[oó]n|not ready to ship|not ready|no listo para desplegar|¿?(ready to ship|listo para desplegar)\?/gi;
const affirmative = (text: string) => AFFIRMATIVE.test(text.replace(NEUTRAL, " "));

function verdictFor(kind: "ready_full" | "ready_low_incomplete" | "ready_medium_incomplete" | "not_ready_low" | "insufficient") {
  const base = { projectId: P, repositoryId: P, scanId: "22222222-2222-4222-8222-222222222222", commitSha: "ce0ea7e", branch: "main", topPriorities: [] as never };
  switch (kind) {
    case "ready_full":
      return buildVerdictFixture({ ...base, status: "ready_to_ship", score: 100, confidence: "high", blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, unevaluatedAreas: [], partiallyEvaluatedAreas: [] } as never);
    case "ready_low_incomplete":
      return buildVerdictFixture({ ...base, status: "ready_to_ship", score: 100, confidence: "low", blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, unevaluatedAreas: [area("testing"), area("performance")] } as never);
    case "ready_medium_incomplete":
      return buildVerdictFixture({ ...base, status: "ready_to_ship", score: 100, confidence: "medium", blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, unevaluatedAreas: [area("testing")] } as never);
    case "not_ready_low":
      return buildVerdictFixture({ ...base, status: "not_ready", score: 0, confidence: "low", blockersCount: 10, criticalBlockersCount: 1, highBlockersCount: 9 } as never);
    case "insufficient":
      return buildVerdictFixture({ ...base, status: "insufficient_data", score: null, confidence: "low", blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0 } as never);
  }
}

async function surfaces(verdict: ReturnType<typeof verdictFor>, lang: Lang) {
  const t = translator(lang);
  const affirms = verdictAffirmsDeploy(verdict);
  const view = verdictExperienceFromVerdict(verdict);
  const hero = heroViewFromVerdict(verdict);

  // Dashboard hero (rendered)
  const summary = summaryFromVerdict({ id: P, name: "Proj" }, verdict);
  const focus = pickPrimaryDashboardFocus([summary], new Map([[P, verdict]]))!;
  const dash = msg(lang, "dashboard") as Record<string, string>;
  const dashboardHtml = renderToStaticMarkup(
    createElement(ProductionControlCenter, {
      greeting: "hi",
      focus,
      labels: {
        productionVerdict: "Production verdict", readyToShipQuestion: dash.readyToShipQuestion, deployYes: dash.deployYes, deployNo: dash.deployNo,
        deployEvidenceLimited: dash.deployEvidenceLimited, almostReady: dash.almostReady, fixThisFirst: dash.fixThisFirst, fixIssue: dash.fixIssue,
        reviewProject: dash.reviewProject, firstVerdictWelcome: "",
      },
    } as never)
  ).replace(/<[^>]+>/g, " ");

  // MCP (the real tool path)
  const admin = createFakeAdmin({
    projects: [{ id: P, name: "Proj", github_repo: "a/b", organization_id: "org-a", created_at: "2026-01-01" }],
    production_verdicts: [verdictRow(P, verdict)],
    repository_scan_state: [], scan_findings: [], scans: [], profiles: [],
    github_webhooks: [{ project_id: P, active: true, callback_url: null, last_delivery_at: "2026-01-01T00:00:00.000Z" }],
    repository_sync_status: [{ project_id: P, commit_sha: null, connection_status: "connected", last_error: null }],
  } as never);
  const stored = (await getCurrentProductionVerdict(admin as never, "org-a", P))!;
  const mcp = await canIDeploy(testMcpAuthContext(admin as never, { organizationId: "org-a" }), {}, getMcpTranslator("en"));

  const gh = githubDecisionPresentation(stored);
  const decision = protectionDecisionFor({ verdict: stored, reviewInProgress: false });
  const protectionStatus = evaluateProtectionStatus({
    continuousProtectionEnabled: true, continuousProtectionPaused: false, githubConnected: true, hasSuccessfulReview: true,
    lastCheckAt: new Date().toISOString(), consecutiveDailyFailures: 0, decision, productionConfidenceDelta7d: 0, securityConfidenceDelta7d: 0,
    materialChangeIn7d: false, attackSurfaceIncreased: false, newCriticalDependencyAdvisory: false, staleCheckWhileCpOn: false,
  });
  const protectionLabel = decision.state === "verdict" ? t(`missionControl.protection.posture.${decision.posture}`) : "";

  // Production Journey (History tab): maturity + posture row, from the same persisted verdict.
  const journey = buildProductionJourney([
    {
      id: "55555555-5555-4555-8555-555555555555", scanId: verdict.scanId, projectId: verdict.projectId, repositoryId: verdict.repositoryId,
      generatedAt: verdict.generatedAt, commitSha: verdict.commitSha, branch: verdict.branch, status: verdict.status, score: verdict.score,
      previousScore: null, scoreDelta: null, blockersCount: verdict.blockersCount, introducedBlockers: 0, resolvedBlockers: 0, verdict,
    },
  ]);
  const journeyLabel = (key: string) => translator(lang)(`productionJourney.${key}`);

  const mcT = (key: string) => translator(lang)(`missionControl.${key}`);
  const texts = {
    // Evidence-card sentence: must agree with the canonical posture AND the blocker count.
    evidenceCard: deploymentRecommendationText(verdict, mapVerdictDisplay(verdict, mcT as never), mcT as never),
    journeyMaturity: journeyLabel(`maturityValues.${journeyMaturityKey(journey, false)}`),
    journeyPosture: journeyLabel(`posture.${journeyPostureKey(journey, false)}`),
    journeyMilestones: journey.milestones.map((m) => journeyLabel(m.titleKey)).join(" | "),
    badgeLabel: verdictStatusLabel(verdict.status, t, affirms),
    badgeHeadline: verdictStatusHeadline(verdict.status, t, affirms),
    badgeMessage: verdictStatusMessage(verdict.status, t, affirms),
    canIDeploy: t(canIDeployKey(verdict.status, view.affirmsDeploy)),
    viewHeadline: view.headline,
    viewMessage: view.statusMessage,
    heroHeadline: hero.headline,
    dashboard: dashboardHtml,
    protection: protectionLabel,
    // Run selector: label from the persisted verdict's CANONICAL posture (as list-analysis-runs computes it).
    selector: formatAnalysisRunStatusLabel(verdict.status, (k) => t(`missionControl.${k}`), (k) => t(`verdict.${k}`), deploymentPostureOf(verdict) === "ready"),
    // Scanner Results only knows the raw status: it must be conservative on its own.
    scannerResults: verdictStatusLabel(verdict.status, t),
    github: `${gh.title} ${gh.label}`,
    mcp: `${mcp.summary} ${mcp.nextAction}`,
  };
  return { texts, affirms, view, hero, focus, mcp, gh, decision, protectionStatus, commitState: commitStatusStateFor(gh, stored.status, "passed") };
}

describe("one canonical verdict -> consistent Web, Dashboard, Protection, GitHub and MCP", () => {
  for (const lang of ["en", "es"] as const) {
    it(`[${lang}] HIGH + complete + ready: every surface may affirm, and they agree`, async () => {
      const s = await surfaces(verdictFor("ready_full"), lang);
      expect(s.affirms).toBe(true);
      expect(s.focus.orgCanDeploy).toBe(true);
      expect(s.hero.affirmsDeploy).toBe(true);
      expect(s.decision).toMatchObject({ posture: "ready" });
      expect(s.protectionStatus).toBe("PROTECTED");
      expect(s.gh.conclusion).toBe("success");
      expect(s.commitState).toBe("success");
      expect(s.mcp.deploymentRecommendation).toBe("SHIP_IT");
      expect(affirmative(s.texts.journeyMaturity)).toBe(true);
      expect(s.texts.evidenceCard).toBe(translator(lang)("missionControl.verdict.deploymentRecommendation.safe"));
      expect(affirmative(s.texts.journeyPosture)).toBe(true);
    });

    it.each(["ready_low_incomplete", "ready_medium_incomplete", "not_ready_low", "insufficient"] as const)(
      `[${lang}] %s: NO surface may read as an affirmative deployment decision`,
      async (kind) => {
        const s = await surfaces(verdictFor(kind), lang);
        expect(s.affirms).toBe(false);
        expect(s.focus.orgCanDeploy).toBe(false);
        expect(s.hero.affirmsDeploy).toBe(false);
        expect(s.view.showReadyMoment).toBe(false);
        expect(s.protectionStatus).not.toBe("PROTECTED");
        expect(s.protectionStatus).not.toBe("SAFE_WITH_CAUTION");
        expect(s.gh.conclusion).not.toBe("success");
        expect(s.commitState).not.toBe("success");
        expect(s.mcp.deploymentRecommendation).not.toBe("SHIP_IT");
        for (const [surface, text] of Object.entries(s.texts)) {
          expect(affirmative(text), `${lang}/${kind}/${surface}: "${text.slice(0, 120)}"`).toBe(false);
        }
      }
    );
  }

  it("the postures agree across surfaces for LOW + incomplete + zero blockers + score 100", async () => {
    const v = verdictFor("ready_low_incomplete");
    const s = await surfaces(v, "en");
    expect(deploymentPostureOf(v)).toBe("ready_evidence_limited");
    expect(s.decision).toMatchObject({ posture: "ready_evidence_limited" });
    expect(s.gh.title).toMatch(/EVIDENCE LIMITED/);
    expect(s.texts.dashboard).toMatch(/evidence limited/i);
    expect(s.mcp.deploymentRecommendation).toBe("MORE_ANALYSIS_REQUIRED");
  });

  it("the TokenAi case (not_ready, LOW, 10 blockers): Protection reflects NOT READY, never 'safe with caution'", async () => {
    const s = await surfaces(verdictFor("not_ready_low"), "es");
    expect(s.decision).toMatchObject({ posture: "not_ready" });
    expect(s.texts.protection).toBe("No listo para desplegar");
    expect(s.texts.protection).not.toMatch(/segura/i);
  });
});

describe("Phase 8I.1: status-only surfaces cannot produce approval language", () => {
  it("the Scanner Results / history label (raw status only) is never affirmative, even for ready_to_ship", () => {
    for (const lang of ["en", "es"] as const) {
      const t = translator(lang);
      for (const status of ["ready_to_ship", "almost_ready", "needs_improvement", "not_ready", "insufficient_data", "analysis_failed"] as const) {
        expect(affirmative(verdictStatusLabel(status, t)), `${lang}/${status}`).toBe(false);
      }
    }
  });

  it("the run selector only reads 'ready' for the canonical 'ready' posture; HIGH + complete does", async () => {
    for (const lang of ["en", "es"] as const) {
      const s = await surfaces(verdictFor("ready_full"), lang);
      expect(affirmative(s.texts.selector), `${lang} selector for a genuinely ready verdict`).toBe(true);
    }
  });
});

describe("Phase 8I.2: evidence card and score labels cannot contradict the canonical posture", () => {
  it.each(["en", "es"] as const)("[%s] zero blockers + limited/insufficient evidence never says 'resolve blockers'", async (lang) => {
    for (const kind of ["ready_low_incomplete", "ready_medium_incomplete", "insufficient"] as const) {
      const s = await surfaces(verdictFor(kind), lang);
      expect(s.texts.evidenceCard, `${lang}/${kind}`).not.toMatch(/blockers are resolved|resolver los bloqueos/i);
    }
  });

  it.each(["en", "es"] as const)("[%s] blockers > 0 keeps blocker language", async (lang) => {
    const s = await surfaces(verdictFor("not_ready_low"), lang);
    expect(s.texts.evidenceCard).toBe(translator(lang)("missionControl.verdict.deploymentRecommendation.blocked"));
  });
});

