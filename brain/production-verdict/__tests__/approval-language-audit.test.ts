import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 8I.1 allow-list audit. A deployment-approval conclusion must come from the canonical posture
 * (deploymentPostureOf / narrativeMayApprove / the MCP decision policy), never from a raw `ready_to_ship`
 * status or a score. Every production source file that mentions `ready_to_ship` or approval wording, and every
 * English message key that carries approval wording, must be classified here:
 *   A = canonical/gated (or the producer of the canonical decision)
 *   B = conservative / non-approval (layout, tone, mapping, negations, questions, analytics)
 *   C = demo / unused / historical-only
 * There is deliberately NO "D". A new occurrence fails this test until it is reviewed and classified, which is
 * what the dynamic-key guard (verdict-label-source-guard) could not do: it missed the Production Journey.
 */
type Class = "A" | "B" | "C";

const READY_TO_SHIP_FILES: Record<string, Class> = {
  "app/(dashboard)/projects/[id]/pull-requests/[number]/page.tsx": "A",
  "brain/production-intelligence/build.ts": "A",
  "brain/production-intelligence/schema.ts": "B",
  "brain/production-journey/build.ts": "A",
  "brain/production-journey/maturity.ts": "A",
  "brain/production-journey/milestones.ts": "A",
  "brain/production-journey/schema.ts": "A",
  "brain/production-verdict/adapters/format.ts": "A",
  "brain/production-verdict/build-verdict.ts": "B",
  "brain/production-verdict/can-i-deploy-key.ts": "A",
  "brain/production-verdict/deployment-posture.ts": "A",
  "brain/production-verdict/experience-view.ts": "A",
  "brain/production-verdict/finalize-verdict.ts": "A",
  "brain/production-verdict/hero-view.ts": "A",
  "brain/production-verdict/narrative-guard.ts": "A",
  "brain/production-verdict/safe-fix-eligibility.ts": "B",
  "brain/production-verdict/status-rules.ts": "B",
  "brain/production-verdict/summary.ts": "A",
  "components/sequrai/ProductionVerdictCard.tsx": "A",
  "features/dashboard/components/ProductionControlCenter.tsx": "A",
  "features/mission-control/components/MissionControlReason.tsx": "A",
  "features/mission-control/lib/build-mission-control-view.ts": "A",
  "features/mission-control/lib/build-security-timeline.ts": "A",
  "features/production-verdict/components/ReadyToShipMoment.tsx": "A",
  "features/production-verdict/components/VerdictStatusBadge.tsx": "A",
  "lib/dashboard/pick-primary-project.ts": "A",
  "lib/i18n/analysis-run-status.ts": "A",
  "lib/i18n/verdict-copy.ts": "A",
  "server/continuous-protection/status-machine.ts": "A",
  "server/full-product-audit/orchestrate.ts": "A",
  "lib/local-analysis/run-local-verdict.ts": "A", // local narrative headline gated by verdictAffirmsDeploy (localVerdictHeadline)
  "server/full-product-audit/format-response.ts": "A", // headline gated by result.affirmsDeploy (auditHeadline)
  "server/full-product-audit/types.ts": "A", // carries the canonical affirmsDeploy flag
  "server/github-automation/github-check-run.ts": "A",
  "server/mcp/decision-language-policy.ts": "A",
  "server/mcp/decision-mapping.ts": "A",
  "server/mcp/personality.ts": "A",
  "server/production-memory/types.ts": "A",
  "brain/autopilot-experience/build-state.ts": "B",
  "brain/fix-prompt/build-production-fix-prompt.ts": "B",
  "brain/production-verdict/adapters/legacy.ts": "B",
  "brain/production-verdict/schema.ts": "B",
  "brain/production-verdict/status-ui.ts": "B",
  "features/mission-control/components/MissionControlExperience.tsx": "B",
  "features/mission-control/components/MissionControlTechnicalDetails.tsx": "B",
  "features/onboarding/onboarding-flow.ts": "B",
  "features/production-verdict/components/ProductionEngineerSummary.tsx": "B",
  "features/production-verdict/components/ProductionVerdictExperience.tsx": "B",
  "lib/analytics/track.ts": "B",
  "lib/dashboard/filter-portfolio-projects.ts": "B",
  "lib/design-system/verdict.ts": "B",
  "server/mission-control/derive-mission-control-ui.ts": "B",
  "features/brain/components/ProductionHero.tsx": "C",
};

const APPROVAL_PHRASE_FILES: Record<string, Class> = {
  "brain/fix-prompt/build-production-fix-prompt.ts": "B",
  "brain/production-experience/levels.ts": "C",
  "brain/production-experience/project-status.ts": "C",
  "brain/production-journey/milestones.ts": "A",
  "brain/production-verdict/adapters/format.ts": "A",
  "brain/production-verdict/schema.ts": "B",
  "features/brain/components/ProductionTimelineFeed.tsx": "B",
  "features/demo/scenarios.ts": "C",
  "server/ai-red-team/decision/decision-engine.ts": "A",
  "server/ai-red-team/decision/production-verdict-bridge.ts": "A",
  "server/github-automation/github-check-run.ts": "A",
  "server/mcp/decision-language-policy.ts": "A",
  "server/mcp/evaluation/intent-dataset.ts": "C",
};

const APPROVAL_MESSAGE_KEYS: Record<string, Class> = {
  "dashboard.deployYes": "A",
  "dashboard.portfolioReady": "C",
  "dashboard.readyToShipQuestion": "B",
  "dashboard.welcomeBody": "B",
  "integrations.webhookHealthAllHealthy": "B",
  "mcp.canIDeploy.deploy": "A",
  "mcp.safeFix.noActionable.notReadyWithoutSpecificFinding": "B",
  "mcp.whatChanged.stateDoNotDeploy": "B",
  "missionControl.empty.noVerdictBody": "B",
  "missionControl.protection.posture.not_ready": "B",
  "missionControl.verdict.display.safeToDeploy": "A",
  "onboarding.createWorkspace": "B",
  "onboarding.dashboardEyebrow": "C",
  "onboarding.finaleReadyCelebration": "A",
  "onboarding.welcomeHeadline": "B",
  "productionIntelligence.emptyStates.ready_to_ship": "A",
  "productionIntelligence.recommendedAction.maintainReadinessDescription": "A",
  "productionJourney.maturityValues.production_maintained": "A",
  "productionJourney.maturityValues.production_ready": "A",
  "productionJourney.milestones.readyToShip": "A",
  "productionJourney.posture.not_ready": "B",
  "productionJourney.posture.ready": "A",
  "projects.onboardedBannerReady": "A",
  "projects.safeFixStep3Body": "B",
  "readiness.analyze.description": "B",
  "readiness.analyze.headline": "B",
  "securityTest.phases.needs_review.headline": "B",
  "verdict.readyMoment.badge": "A",
  "verdict.status.not_ready.headline": "B",
  "verdict.status.not_ready.label": "B",
  "verdict.status.ready_to_ship.headline": "A",
  "verdict.status.ready_to_ship.label": "A",
  "verdict.status.ready_to_ship.message": "A",
};

const ROOTS = ["app", "features", "components", "lib", "server", "brain", "mcp", "inngest"];
const SOURCE = /\.(ts|tsx|mjs)$/;
const IS_TEST = /(__tests__|\.test\.|\/fixtures\/)/;
const PHRASES = /Production Ready(?! Score)|Production Maintained|Ready to Ship|Ready to deploy|Safe to deploy|Ship it\b/;
const MESSAGE_PHRASES = /production ready(?! score)|production maintained|ready to ship|ready to deploy|safe to deploy|ship it\b|ready for production|ready to go/i;

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (IS_TEST.test(path)) continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE.test(name)) out.push(path);
  }
  return out;
}

const sources = ROOTS.flatMap((root) => walk(root));

function messageKeys(): string[] {
  const keys: string[] = [];
  for (const file of readdirSync("messages/en")) {
    const ns = file.replace(/\.json$/, "");
    const visit = (node: unknown, path: string[]) => {
      if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) visit(v, [...path, k]);
      else if (typeof node === "string" && MESSAGE_PHRASES.test(node)) keys.push(`${ns}.${path.join(".")}`);
    };
    visit(JSON.parse(readFileSync(join("messages/en", file), "utf8")), []);
  }
  return keys;
}

describe("approval-language audit (no unclassified path to deployment-approval wording)", () => {
  it("every production file mentioning ready_to_ship is classified", () => {
    const found = sources.filter((f) => /ready_to_ship/.test(readFileSync(f, "utf8")));
    const unclassified = found.filter((f) => !(f in READY_TO_SHIP_FILES));
    expect(unclassified, "classify new ready_to_ship usage as A (gated), B (non-approval) or C (demo/unused); never raw approval").toEqual([]);
  });

  it("every production file with approval wording is classified", () => {
    const found = sources.filter((f) => PHRASES.test(readFileSync(f, "utf8")));
    const unclassified = found.filter((f) => !(f in APPROVAL_PHRASE_FILES) && !(f in READY_TO_SHIP_FILES));
    expect(unclassified).toEqual([]);
  });

  it("every English message key with approval wording is classified", () => {
    const unclassified = messageKeys().filter((k) => !(k in APPROVAL_MESSAGE_KEYS));
    expect(unclassified, "a new approval-worded message key needs a gated consumer; classify it here after review").toEqual([]);
  });

  it("a class A component without its own gate has exactly one consumer, and that consumer gates it", () => {
    const GATED_BY_CONSUMER: Record<string, { consumer: string; gate: RegExp }> = {
      "features/production-verdict/components/ReadyToShipMoment.tsx": {
        consumer: "features/production-verdict/components/ProductionVerdictHero.tsx",
        gate: /view\.showReadyMoment/,
      },
    };
    for (const [file, { consumer, gate }] of Object.entries(GATED_BY_CONSUMER)) {
      const importers = sources.filter((f) => f !== file && /ReadyToShipMoment/.test(readFileSync(f, "utf8")));
      expect(importers).toEqual([consumer]);
      expect(readFileSync(consumer, "utf8")).toMatch(gate);
    }
  });

  it("class A files use the canonical gate or are the canonical producer", () => {
    const gateTokens = /deploymentPostureOf|verdictAffirmsDeploy|narrativeMayApprove|mapVerdictStatusToDecision|affirmsDeploy|affirms\b|deriveDecisionLanguagePolicy|deploymentPosture|decision-language-policy|verdictCopyKey|currentDeploymentPosture|canIDeployKey|DeploymentPosture|SHIP_IT|ready_evidence_limited|policy|orgCanDeploy|showReadyMoment/;
    const weak = Object.entries(READY_TO_SHIP_FILES)
      .filter(([, cls]) => cls === "A")
      .filter(([file]) => file !== "features/production-verdict/components/ReadyToShipMoment.tsx") // gated by its consumer (above)
      .filter(([file]) => !gateTokens.test(readFileSync(file, "utf8")))
      .map(([file]) => file);
    expect(weak).toEqual([]);
  });

  it("the allow-lists contain no stale entries", () => {
    for (const file of Object.keys(READY_TO_SHIP_FILES)) expect(statSync(file).isFile()).toBe(true);
    for (const file of Object.keys(APPROVAL_PHRASE_FILES)) expect(statSync(file).isFile()).toBe(true);
  });
});
