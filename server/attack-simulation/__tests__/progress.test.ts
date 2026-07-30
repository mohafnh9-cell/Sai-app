import { describe, expect, it } from "vitest";
import {
  assertStepWeightsValid,
  calculateCampaignProgressFromSteps,
  calculateElapsedMs,
  calculateProgressFromSteps,
  DEFAULT_ATTACK_STEP_TEMPLATE,
} from "@/server/attack-simulation";

describe("attack simulation progress", () => {
  it("calculates execution progress from completed step weights", () => {
    const steps = DEFAULT_ATTACK_STEP_TEMPLATE.map((template, index) => ({
      weight: template.weight,
      status: index <= 2 ? ("completed" as const) : ("pending" as const),
      durationMs: index <= 2 ? 1000 : null,
    }));

    const progress = calculateProgressFromSteps(steps);
    expect(progress.totalWeight).toBe(100);
    expect(progress.completedWeight).toBe(35);
    expect(progress.progressPercent).toBe(35);
    expect(progress.estimatedRemainingMs).not.toBeNull();
  });

  it("aggregates campaign progress from all steps in the campaign", () => {
    const steps = [
      { weight: 35, status: "completed" as const, durationMs: 500 },
      { weight: 25, status: "completed" as const, durationMs: 1200 },
      { weight: 20, status: "pending" as const, durationMs: null },
      { weight: 20, status: "pending" as const, durationMs: null },
    ];

    const progress = calculateCampaignProgressFromSteps(steps, { historicalMsPerWeight: 100 });
    expect(progress.progressPercent).toBe(60);
    expect(progress.estimatedRemainingMs).toBe(4000);
  });

  it("returns 100% when all steps are completed", () => {
    const steps = DEFAULT_ATTACK_STEP_TEMPLATE.map((template) => ({
      weight: template.weight,
      status: "completed" as const,
      durationMs: 250,
    }));
    const progress = calculateProgressFromSteps(steps);
    expect(progress.progressPercent).toBe(100);
    expect(progress.estimatedRemainingMs).toBe(0);
  });

  it("calculates elapsed time from startedAt", () => {
    const startedAt = new Date(Date.now() - 5000).toISOString();
    expect(calculateElapsedMs(startedAt, Date.now())).toBeGreaterThanOrEqual(5000);
  });

  it("throws when step weights are invalid", () => {
    expect(() => assertStepWeightsValid([{ weight: 0 }])).toThrow(/positive weight/i);
  });
});
