import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildRecommendation } from "../orchestrate";

const base = { topRisks: [], counts: { confirmed: 0, critical: 0, high: 0 } } as never;
const SHIP = /ship when|blocking deploy/i;

describe("Full Product Audit recommendation is not a status-only approval (Phase 8I.1)", () => {
  it("ready_to_ship without the canonical evidence gate never says ship", () => {
    for (const affirmsDeploy of [undefined, false]) {
      const text = buildRecommendation({ ...(base as object), verdictStatus: "ready_to_ship", affirmsDeploy } as never);
      expect(text).not.toMatch(SHIP);
      expect(text).toMatch(/not a deployment approval/i);
    }
  });

  it("ready_to_ship WITH the canonical gate keeps the ship wording", () => {
    expect(buildRecommendation({ ...(base as object), verdictStatus: "ready_to_ship", affirmsDeploy: true } as never)).toMatch(SHIP);
  });

  it("confirmed vulnerabilities, insufficient evidence and no verdict still never approve", () => {
    expect(buildRecommendation({ topRisks: [], counts: { confirmed: 1, critical: 0, high: 0 }, verdictStatus: "ready_to_ship", affirmsDeploy: true } as never)).toMatch(/do not deploy/i);
    for (const verdictStatus of ["insufficient_data", "analysis_failed", null, "not_ready"]) {
      expect(buildRecommendation({ ...(base as object), verdictStatus, affirmsDeploy: true } as never)).not.toMatch(SHIP);
    }
  });
});
