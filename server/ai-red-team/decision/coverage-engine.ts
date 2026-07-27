import type { SecurityIntelligenceReport } from "../intelligence/models";
import type { DecisionContext } from "./decision-context";

export type CoverageAssessment = {
  score: number;
  gaps: string[];
  recommendedTesting: string[];
  dimensions: {
    anonymous: number;
    authenticated: number;
    admin: number;
    api: number;
    browser: number;
    discovery: number;
    replay: number;
  };
};

export function evaluateCoverage(input: {
  intelligence: SecurityIntelligenceReport;
  context: DecisionContext;
}): CoverageAssessment {
  const gaps: string[] = [];
  const recommendedTesting: string[] = [];

  const browserResults = input.intelligence.verdict.coverage.some((c) =>
    c.toLowerCase().includes("browser")
  );
  const browserRan = browserResults || input.intelligence.deduplicatedFindings.some((f) => f.domain === "browser");
  const discovery = Math.min(1, input.intelligence.verdict.coverage.length > 0 ? 0.7 : 0.3);

  let anonymous = browserRan ? 0.7 : 0.2;
  let authenticated = input.context.memory?.events.some((e) => e.type.includes("auth")) ? 0.5 : 0.15;
  let admin = input.intelligence.graph.nodes.some((n) => n.kind === "privilege") ? 0.4 : 0.1;
  let api = input.intelligence.graph.nodes.some((n) => n.label.toLowerCase().includes("api")) ? 0.35 : 0.1;
  let browser = browserRan ? 0.75 : 0.1;
  let replay =
    input.context.replayStatus === "passed" ? 0.9 : input.context.replayStatus === "failed" ? 0.1 : 0;

  if (!browserRan) {
    gaps.push("Browser simulation coverage missing or incomplete.");
    recommendedTesting.push("Run authorized Browser Team against preview/staging.");
  }
  if (authenticated < 0.4) {
    gaps.push("Authenticated user journeys not adequately covered.");
    recommendedTesting.push("Run Authentication Team with approved test identities.");
  }
  if (admin < 0.35) {
    gaps.push("Admin or privileged routes not validated.");
  }
  if (api < 0.3) {
    gaps.push("API attack surface not exercised.");
    recommendedTesting.push("Run API Team when available.");
  }
  if (replay === 0) {
    gaps.push("No replay verification available.");
    recommendedTesting.push("Run Replay on top Safe Fix or blocker.");
  }

  const score =
    anonymous * 0.15 +
    authenticated * 0.2 +
    admin * 0.15 +
    api * 0.15 +
    browser * 0.2 +
    discovery * 0.1 +
    replay * 0.05;

  return {
    score: Math.round(score * 100) / 100,
    gaps,
    recommendedTesting,
    dimensions: {
      anonymous,
      authenticated,
      admin,
      api,
      browser,
      discovery,
      replay,
    },
  };
}
