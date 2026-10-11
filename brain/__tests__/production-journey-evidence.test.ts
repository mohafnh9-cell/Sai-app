import { describe, expect, it } from "vitest";
import { buildProductionJourney, calculateTrend, detectMilestones } from "@/brain/production-journey";
import { journeyOf, record, type Kind } from "./fixtures/journey-fixture";

// Journey must not claim production approval, achievements or an improving trend from evidence-limited verdicts.
// Series below mirror the real shapes stored in production (insufficient_data keeps a placeholder score of 100).

const timelineOf = (kinds: Kind[]) => buildProductionJourney(kinds.map((kind, index) => record(kind, index))).timeline;
const types = (kinds: Kind[]) => journeyOf(kinds).milestones.map((m) => m.type);

describe("milestones: approval wording only for evidence-backed READY", () => {
  it("READY with low/medium confidence or unevaluated areas never yields 'ready to ship' or 'recovered'", () => {
    for (const kind of ["ready_low_incomplete", "ready_medium_incomplete"] as const) {
      const found = types([kind, "not_ready", kind, kind]);
      expect(found).toContain("no_blockers_evidence_limited");
      expect(found).not.toContain("ready_to_ship");
      expect(found).not.toContain("recovered_after_regression");
    }
  });

  it("READY with sufficient evidence yields the milestone, carrying the date and commit of THAT verdict", () => {
    const journey = journeyOf(["not_ready", "ready_low_incomplete", "ready_full"]);
    const ready = journey.milestones.find((m) => m.type === "ready_to_ship");
    expect(ready).toBeDefined();
    expect(ready?.commitSha).toBe("c000002");
    expect(ready?.reachedAt).toBe(journey.timeline[2].generatedAt);
    expect(ready?.verdictId).toBe(journey.timeline[2].verdictId);
  });

  it("historical transitions: READY(full) → regression → READY(limited) → READY(full): 'recovered' appears only at the full-evidence point", () => {
    const journey = journeyOf(["ready_full", "not_ready", "ready_low_incomplete", "ready_full"]);
    const recovered = journey.milestones.filter((m) => m.type === "recovered_after_regression");
    expect(recovered).toHaveLength(1);
    expect(recovered[0].commitSha).toBe("c000003");
    // the regression recovered through a limited-evidence READY alone is not a recovery
    expect(types(["ready_full", "not_ready", "ready_low_incomplete"])).not.toContain("recovered_after_regression");
  });

  it("every milestone is a fact about a commit: it carries the commit of its verdict", () => {
    for (const milestone of journeyOf(["not_ready", "ready_full", "ready_full"]).milestones) {
      expect(milestone.commitSha).toMatch(/^c\d{6}$/);
    }
  });

  it("an insufficient_data placeholder score creates no score/best-score milestone and no best score", () => {
    const journey = journeyOf(["insufficient_scored", "insufficient_scored"]);
    const found = journey.milestones.map((m) => m.type);
    expect(found).not.toContain("score_50");
    expect(found).not.toContain("score_70");
    expect(found).not.toContain("best_score");
    expect(journey.bestScore).toBeNull();
    expect(journey.lowestScore).toBeNull();
  });
});

describe("trend: a placeholder score is not evidence of improvement", () => {
  // production, 2026-10-09/10: ... 64, 64, 100, 100, 64, 100, 100 then three insufficient_data verdicts stored with score 100
  const evidence: Kind[] = ["not_ready", "not_ready", "ready_medium_incomplete", "ready_medium_incomplete", "not_ready", "ready_medium_incomplete", "ready_medium_incomplete"];

  it("the same series with trailing insufficient_data placeholders has the same trend as without them", () => {
    const without = calculateTrend(timelineOf(evidence));
    const withPlaceholders = calculateTrend(timelineOf([...evidence, "insufficient_scored", "insufficient_scored", "insufficient_scored"]));
    expect(withPlaceholders).toBe(without);
  });

  it("100 → 100 through placeholders is not 'improving'", () => {
    const trend = calculateTrend(timelineOf(["ready_medium_incomplete", "not_ready", "ready_medium_incomplete", "ready_medium_incomplete", "insufficient_scored", "insufficient_scored", "insufficient_scored"]));
    expect(trend).not.toBe("improving");
  });

  it("a real, sustained improvement is still reported as improving", () => {
    expect(calculateTrend(timelineOf(["not_ready", "not_ready", "not_ready", "ready_medium_incomplete", "ready_medium_incomplete", "ready_medium_incomplete"]))).toBe("improving");
  });

  it("only placeholder points: not enough evidence for a trend", () => {
    expect(calculateTrend(timelineOf(["insufficient_scored", "insufficient_scored", "insufficient_scored"]))).toBe("insufficient_data");
  });
});

describe("detectMilestones is unchanged for a timeline with evidence", () => {
  it("still reports first verdict and best score for evidence-bearing points", () => {
    const found = detectMilestones(timelineOf(["not_ready", "ready_full"])).map((m) => m.type);
    expect(found).toEqual(expect.arrayContaining(["first_verdict", "best_score"]));
  });
});
