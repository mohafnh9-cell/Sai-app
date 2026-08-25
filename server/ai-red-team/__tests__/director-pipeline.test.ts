import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createAttackPlanner } from "../execution/attack-planner";
import {
  resolveDirectorPipelineDomains,
  SECURITY_DIRECTOR_CORE_TEAM_ORDER,
  SECURITY_DIRECTOR_TEAM_ORDER,
  SECURITY_DIRECTOR_LLM_DOMAIN,
} from "../director/pipeline";
import { createAuthenticationTeam } from "../teams/authentication/authentication-team";
import { withFeatureFlagOverrides } from "./test-support/feature-flag-override";

const INTERNAL_ORG = "org-internal-pipeline";

function resolveDirectorPipelineDomainsWithTeamsGatedInternal(
  ...args: Parameters<typeof resolveDirectorPipelineDomains>
) {
  return withFeatureFlagOverrides(
    { business_logic_team: "internal", llm_team: "internal" },
    async () => {
      const { resolveDirectorPipelineDomains: resolveFresh } = await import("../director/pipeline");
      return resolveFresh(...args);
    }
  );
}

describe("Security Director pipeline", () => {
  const prevInternal = process.env.SEQURAI_INTERNAL_ORG_IDS;

  beforeEach(() => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = INTERNAL_ORG;
  });

  afterEach(() => {
    if (prevInternal === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prevInternal;
  });

  it("orders browser before authentication in the plan", () => {
    const planner = createAttackPlanner();
    const plan = planner.createPlan({
      context: { projectId: "p", organizationId: INTERNAL_ORG },
      scope: [...SECURITY_DIRECTOR_TEAM_ORDER],
      domainOrder: [...SECURITY_DIRECTOR_TEAM_ORDER],
    });
    expect(plan.phases.map((p) => p.domain)).toEqual([
      "browser",
      "authentication",
      "api",
      "authorization",
      "payments",
    ]);
    expect(plan.phases[4]?.dependsOn).toContain("phase-authorization");
  });

  it("excludes payments from director scope when business_logic_team is disabled", async () => {
    delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    const domains = await resolveDirectorPipelineDomainsWithTeamsGatedInternal({
      requestId: "r",
      context: { projectId: "p", organizationId: "org-public" },
      directorPipeline: true,
    });
    expect(domains).toEqual([...SECURITY_DIRECTOR_CORE_TEAM_ORDER]);
    expect(domains).not.toContain("payments");
  });

  it("includes payments and llm when team flags are enabled for the org", () => {
    const domains = resolveDirectorPipelineDomains({
      requestId: "r",
      context: { projectId: "p", organizationId: INTERNAL_ORG },
      directorPipeline: true,
    });
    expect(domains).toEqual([...SECURITY_DIRECTOR_TEAM_ORDER, SECURITY_DIRECTOR_LLM_DOMAIN]);
  });

  it("excludes llm from director scope when llm_team is disabled", async () => {
    delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    const domains = await resolveDirectorPipelineDomainsWithTeamsGatedInternal({
      requestId: "r",
      context: { projectId: "p", organizationId: "org-public" },
      directorPipeline: true,
    });
    expect(domains).not.toContain("llm");
  });

  it("authentication team emits findings from discovery auth gap", async () => {
    const team = createAuthenticationTeam();
    const result = await team.run({
      runId: "run-1",
      plan: {
        planId: "plan",
        createdAt: new Date().toISOString(),
        phases: [],
        notes: [],
      },
      discovery: {
        reportId: "d",
        projectId: "p",
        organizationId: "o",
        commitSha: "abc",
        generatedAt: new Date().toISOString(),
        durationMs: 1,
        projectSummary: "",
        detectedTechnologies: [],
        authenticationProviders: [],
        database: [],
        payments: [],
        aiProviders: [],
        infrastructure: [],
        deployment: [],
        storage: [],
        packageManagers: [],
        potentialAttackSurface: [
          { area: "authentication", label: "Login", rationale: "x", confidence: 0.9 },
        ],
        technologyGraph: { nodes: [], edges: [] },
        confidenceScore: 0.8,
        cached: false,
      },
    });
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
