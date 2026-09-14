import { describe, expect, it } from "vitest";
import { buildApplicationSurface } from "../application-surface";
import { buildSecurityPlan } from "../planner";
import { SecurityPlanValidationError, validateSecurityPlan } from "../ai-plan-validation";

const ORG_A = "org-a";
const PROJECT_A = "project-a";
const SCAN_A = "scan-a";

function realPlan() {
  const applicationSurface = buildApplicationSurface({ files: [{ path: "package.json", content: "{}" }], githubRepo: "acme/widgets" });
  return buildSecurityPlan({ scanId: SCAN_A, organizationId: ORG_A, projectId: PROJECT_A, applicationSurface, files: [{ path: "package.json", content: "{}" }] });
}

describe("Phase 36 -- validateSecurityPlan (section 17/18: the AI-plan safety gate)", () => {
  it("accepts a real deterministic plan for its own scan context", () => {
    expect(() => validateSecurityPlan(realPlan(), { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A })).not.toThrow();
  });

  it("rejects a plan referencing an unregistered engine id (an AI hallucination or a spoofed plan)", () => {
    const plan = realPlan();
    plan.decisions.push({ engine: "nuclei" as never, selected: true, capabilities: [], rationale: "fake" });
    plan.selectedEngines.push("nuclei" as never);
    expect(() => validateSecurityPlan(plan, { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A })).toThrow(
      SecurityPlanValidationError
    );
  });

  it("rejects a plan whose organizationId doesn't match the authorized scan context (cross-tenant plan injection)", () => {
    const plan = realPlan();
    expect(() => validateSecurityPlan(plan, { organizationId: "org-attacker", projectId: PROJECT_A, scanId: SCAN_A })).toThrow(
      /organizationId does not match/
    );
  });

  it("rejects a plan that claims dynamic testing is available -- that field must only ever come from the deterministic planner, never AI", () => {
    const plan = realPlan();
    plan.dynamicTestingAvailable = true;
    expect(() => validateSecurityPlan(plan, { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A })).toThrow(
      /dynamicTestingAvailable=true is not permitted/
    );
  });

  it("rejects a decision claiming a capability the engine does not actually declare", () => {
    const plan = realPlan();
    const cryptoDecision = plan.decisions.find((d) => d.engine === "crypto");
    if (cryptoDecision) cryptoDecision.capabilities = ["dependencies" as never];
    expect(() => validateSecurityPlan(plan, { organizationId: ORG_A, projectId: PROJECT_A, scanId: SCAN_A })).toThrow(
      /does not declare capability/
    );
  });
});
