import { afterAll, describe, expect, it } from "vitest";
import { createBusinessLogicTeamCoordinator } from "../../coordinator";
import { discoveryFullBillingStack, emptyAttackPlan, INTERNAL_ORG_RT9 } from "../fixtures";
import { chunkRows } from "../../persistence/serialize-run-artifacts";

describe("RT9 performance benchmarks", () => {
  const prev = process.env.SEQURAI_INTERNAL_ORG_IDS;
  process.env.SEQURAI_INTERNAL_ORG_IDS = INTERNAL_ORG_RT9;

  it("small workload completes within budget", async () => {
    const started = performance.now();
    const result = await createBusinessLogicTeamCoordinator().run({
      organizationId: INTERNAL_ORG_RT9,
      projectId: "perf-small",
      runId: "rt",
      requestId: "req",
      discoveryReport: discoveryFullBillingStack(),
      plan: emptyAttackPlan(),
    });
    const ms = performance.now() - started;
    expect(result.workflowsDiscovered).toBeLessThan(20);
    expect(ms).toBeLessThan(15_000);
  });

  it("medium synthetic artifact batch chunks efficiently", () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i }));
    const chunks = chunkRows(rows, 250);
    expect(chunks.length).toBe(8);
    expect(chunks[0]?.length).toBe(250);
  });

  it("records stage-level duration on coordinator result", async () => {
    const result = await createBusinessLogicTeamCoordinator().run({
      organizationId: INTERNAL_ORG_RT9,
      projectId: "perf-med",
      runId: "rt2",
      requestId: "req2",
      discoveryReport: discoveryFullBillingStack(),
      plan: emptyAttackPlan(),
    });
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.runtimeExecutionsCompleted).toBeLessThanOrEqual(48);
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prev;
  });
});
