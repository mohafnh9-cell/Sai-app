import type { ProductionJourneyPoint, ProductionMilestone } from "./schema";
import { JOURNEY_CONFIG } from "./config";
import { isValidJourneyVerdict } from "./valid-verdict";

export function detectMilestones(timeline: ProductionJourneyPoint[]): ProductionMilestone[] {
  const milestones: ProductionMilestone[] = [];
  let bestScore = -1;
  let hadRegression = false;
  let resolvedBefore = false;

  timeline.forEach((point, index) => {
    if (index === 0) {
      milestones.push({
        id: `${point.verdictId}-first_verdict`,
        type: "first_verdict",
        titleKey: "milestones.firstVerdict",
        reachedAt: point.generatedAt,
        score: point.score,
        verdictId: point.verdictId,
      });
    }

    if (point.resolvedBlockersCount > 0 && !resolvedBefore) {
      resolvedBefore = true;
      milestones.push({
        id: `${point.verdictId}-first_blocker_resolved`,
        type: "first_blocker_resolved",
        titleKey: "milestones.firstBlockerResolved",
        reachedAt: point.generatedAt,
        score: point.score,
        verdictId: point.verdictId,
      });
    }

    if (point.score !== null && point.score >= JOURNEY_CONFIG.scoreMilestone50) {
      const exists = milestones.some((m) => m.type === "score_50");
      if (!exists) {
        milestones.push({
          id: `${point.verdictId}-score_50`,
          type: "score_50",
          titleKey: "milestones.score50",
          reachedAt: point.generatedAt,
          score: point.score,
          verdictId: point.verdictId,
        });
      }
    }

    if (point.score !== null && point.score >= JOURNEY_CONFIG.scoreMilestone70) {
      const exists = milestones.some((m) => m.type === "score_70");
      if (!exists) {
        milestones.push({
          id: `${point.verdictId}-score_70`,
          type: "score_70",
          titleKey: "milestones.score70",
          reachedAt: point.generatedAt,
          score: point.score,
          verdictId: point.verdictId,
        });
      }
    }

    if (point.status === "almost_ready") {
      const exists = milestones.some((m) => m.type === "almost_ready");
      if (!exists) {
        milestones.push({
          id: `${point.verdictId}-almost_ready`,
          type: "almost_ready",
          titleKey: "milestones.almostReady",
          reachedAt: point.generatedAt,
          score: point.score,
          verdictId: point.verdictId,
        });
      }
    }

    if (point.status === "ready_to_ship") {
      // "Ready to Ship reached" is a deployment conclusion: only for the canonical "ready" posture.
      // Otherwise record the historical fact (no blockers found) without approval language.
      const approved = point.deploymentPosture === "ready";
      const type = approved ? "ready_to_ship" : "no_blockers_evidence_limited";
      const exists = milestones.some((m) => m.type === type);
      if (!exists) {
        milestones.push({
          id: `${point.verdictId}-${type}`,
          type,
          titleKey: approved ? "milestones.readyToShip" : "milestones.noBlockersEvidenceLimited",
          reachedAt: point.generatedAt,
          score: point.score,
          verdictId: point.verdictId,
        });
      }
    }

    if (index > 0 && isValidJourneyVerdict(point.status, point.score)) {
      const prev = timeline[index - 1];
      if (prev.status === "ready_to_ship" && point.score !== null && prev.score !== null) {
        if (point.score < prev.score - 5) hadRegression = true;
      }
    }

    if (hadRegression && point.status === "ready_to_ship" && point.deploymentPosture === "ready") {
      const exists = milestones.some(
        (m) => m.type === "recovered_after_regression" && m.reachedAt === point.generatedAt
      );
      if (!exists) {
        milestones.push({
          id: `${point.verdictId}-recovered`,
          type: "recovered_after_regression",
          titleKey: "milestones.recoveredAfterRegression",
          reachedAt: point.generatedAt,
          score: point.score,
          verdictId: point.verdictId,
        });
        hadRegression = false;
      }
    }

    if (point.score !== null && point.score > bestScore) {
      bestScore = point.score;
      const existingBest = milestones.find((m) => m.type === "best_score");
      if (existingBest) {
        existingBest.reachedAt = point.generatedAt;
        existingBest.score = point.score;
        existingBest.verdictId = point.verdictId;
        existingBest.id = `${point.verdictId}-best_score`;
      } else {
        milestones.push({
          id: `${point.verdictId}-best_score`,
          type: "best_score",
          titleKey: "milestones.bestScore",
          reachedAt: point.generatedAt,
          score: point.score,
          verdictId: point.verdictId,
        });
      }
    }

    if (point.blockersCount === 0 && isValidJourneyVerdict(point.status, point.score)) {
      const hadBlockers = timeline
        .slice(0, index)
        .some((p) => p.blockersCount > 0);
      if (hadBlockers) {
        const exists = milestones.some((m) => m.type === "all_critical_resolved");
        if (!exists) {
          milestones.push({
            id: `${point.verdictId}-all_resolved`,
            type: "all_critical_resolved",
            titleKey: "milestones.allCriticalResolved",
            reachedAt: point.generatedAt,
            score: point.score,
            verdictId: point.verdictId,
          });
        }
      }
    }
  });

  const validCount = timeline.filter((p) => isValidJourneyVerdict(p.status, p.score)).length;
  if (validCount >= JOURNEY_CONFIG.tenReviewsCount) {
    const tenth = timeline.filter((p) => isValidJourneyVerdict(p.status, p.score))[
      JOURNEY_CONFIG.tenReviewsCount - 1
    ];
    if (tenth) {
      milestones.push({
        id: `${tenth.verdictId}-ten_reviews`,
        type: "ten_reviews",
        titleKey: "milestones.tenReviews",
        reachedAt: tenth.generatedAt,
        score: tenth.score,
        verdictId: tenth.verdictId,
      });
    }
  }

  return milestones.sort(
    (a, b) => new Date(a.reachedAt).getTime() - new Date(b.reachedAt).getTime()
  );
}

export function nextMilestoneKey(milestones: ProductionMilestone[]): string | null {
  const order = [
    "milestones.firstVerdict",
    "milestones.firstBlockerResolved",
    "milestones.score50",
    "milestones.score70",
    "milestones.almostReady",
    "milestones.readyToShip",
  ];
  const reached = new Set(milestones.map((m) => m.titleKey));
  return order.find((key) => !reached.has(key)) ?? null;
}
