import { describe, expect, it } from "vitest";
import { projectNeedsAttention } from "../filter-portfolio-projects";
import type { ProjectBrainSummary } from "@/brain";

describe("projectNeedsAttention", () => {
  const now = Date.now();

  it("flags not_ready projects", () => {
    expect(
      projectNeedsAttention(
        { status: "not_ready" } as ProjectBrainSummary,
        new Date(now).toISOString()
      )
    ).toBe(true);
  });

  it("flags stale projects that are not ready_to_ship", () => {
    const stale = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      projectNeedsAttention(
        { status: "almost_ready" } as ProjectBrainSummary,
        stale
      )
    ).toBe(true);
  });

  it("does not flag fresh ready_to_ship projects", () => {
    expect(
      projectNeedsAttention(
        { status: "ready_to_ship" } as ProjectBrainSummary,
        new Date(now).toISOString()
      )
    ).toBe(false);
  });
});
