import { afterAll, describe, expect, it } from "vitest";
import { createBusinessLogicTeamCoordinator } from "../../coordinator";
import { discoveryFullBillingStack, emptyAttackPlan, INTERNAL_ORG_RT9 } from "../fixtures";

describe("RT9 determinism (semantic stability)", () => {
  const prev = process.env.SEQURAI_INTERNAL_ORG_IDS;
  process.env.SEQURAI_INTERNAL_ORG_IDS = INTERNAL_ORG_RT9;

  async function runOnce() {
    return createBusinessLogicTeamCoordinator().run({
      organizationId: INTERNAL_ORG_RT9,
      projectId: "det",
      runId: "rt-det",
      requestId: "req-det",
      discoveryReport: discoveryFullBillingStack(),
      plan: emptyAttackPlan(),
    });
  }

  it("stable counts and workflow kinds across identical discovery runs", async () => {
    const a = await runOnce();
    const b = await runOnce();
    expect(a.workflowsDiscovered).toBe(b.workflowsDiscovered);
    expect(a.invariantsExtracted).toBe(b.invariantsExtracted);
    expect(a.abuseHypothesesGenerated).toBe(b.abuseHypothesesGenerated);
    expect(a.findingsCount).toBe(b.findingsCount);
    const kindsA = (a.context?.workflows.map((w) => w.kind) ?? []).sort();
    const kindsB = (b.context?.workflows.map((w) => w.kind) ?? []).sort();
    expect(kindsA).toEqual(kindsB);
  });

  it("stable finding keys when findings exist", async () => {
    const result = await runOnce();
    const findings = result.context?.domainModel?.findingCollection?.findings ?? [];
    if (findings.length === 0) return;
    const keys = findings.map((f) => f.findingKey).sort();
    const again = await runOnce();
    const keys2 = (again.context?.domainModel?.findingCollection?.findings ?? [])
      .map((f) => f.findingKey)
      .sort();
    expect(keys).toEqual(keys2);
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prev;
  });
});
