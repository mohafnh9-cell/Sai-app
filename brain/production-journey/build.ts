import type { ProductionVerdictV1, VerdictStatus } from "@/brain/production-verdict/schema";
import { deploymentPostureOf } from "@/brain/production-verdict/deployment-posture";
import { JOURNEY_CONFIG } from "./config";
import {
  type ProductionJourney,
  type ProductionJourneyPoint,
  ProductionJourneySchema,
  type JourneyHighlight,
} from "./schema";
import { isChartableVerdict, isValidJourneyVerdict } from "./valid-verdict";
import { calculateTrend, calculateScoreChange } from "./trend";
import { calculateMaturity } from "./maturity";
import { detectMilestones, nextMilestoneKey } from "./milestones";
import { determineCurrentFocus } from "./focus";
import { buildAreasProgress } from "./areas-progress";

export type VerdictJourneyRecord = {
  id: string;
  scanId: string;
  projectId: string;
  repositoryId: string;
  generatedAt: string;
  commitSha: string | null;
  branch: string | null;
  status: VerdictStatus;
  score: number | null;
  previousScore: number | null;
  scoreDelta: number | null;
  blockersCount: number;
  introducedBlockers: number;
  resolvedBlockers: number;
  verdict: ProductionVerdictV1;
};

export type BuildProductionJourneyOptions = {
  limit?: number;
  offset?: number;
};

function toTimelinePoint(record: VerdictJourneyRecord): ProductionJourneyPoint {
  return {
    verdictId: record.id,
    scanId: record.scanId,
    commitSha: record.commitSha,
    branch: record.branch,
    score: record.score,
    status: record.status,
    // The ONE canonical gate; an unreadable verdict stays undefined (never an approval).
    deploymentPosture: record.verdict ? deploymentPostureOf(record.verdict) : undefined,
    scoreDelta: record.scoreDelta,
    blockersCount: record.blockersCount,
    introducedBlockersCount: record.introducedBlockers,
    resolvedBlockersCount: record.resolvedBlockers,
    generatedAt: record.generatedAt,
    isValidForScoreChart: isChartableVerdict(record.status, record.score),
  };
}

function bestStatusFromTimeline(
  timeline: ProductionJourneyPoint[]
): VerdictStatus | null {
  const order: VerdictStatus[] = [
    "ready_to_ship",
    "almost_ready",
    "needs_improvement",
    "not_ready",
    "insufficient_data",
    "analysis_failed",
  ];
  let best: VerdictStatus | null = null;
  let bestRank = -1;
  for (const point of timeline) {
    if (!isValidJourneyVerdict(point.status, point.score)) continue;
    const rank = order.indexOf(point.status);
    if (rank > bestRank) {
      bestRank = rank;
      best = point.status;
    }
  }
  return best;
}

function buildHighlights(
  milestones: ReturnType<typeof detectMilestones>,
  latest: ProductionJourneyPoint | null
): JourneyHighlight[] {
  const highlights: JourneyHighlight[] = milestones.slice(-3).map((m) => ({
    id: m.id,
    titleKey: m.titleKey,
    descriptionKey: m.titleKey,
    occurredAt: m.reachedAt,
  }));

  if (latest?.scoreDelta != null && latest.scoreDelta !== 0) {
    highlights.unshift({
      id: `latest-delta-${latest.verdictId}`,
      titleKey:
        latest.scoreDelta > 0 ? "highlights.scoreIncreased" : "highlights.scoreDecreased",
      descriptionKey: "highlights.latestReview",
      occurredAt: latest.generatedAt,
    });
  }

  return highlights.slice(0, 5);
}

export function buildProductionJourney(
  records: VerdictJourneyRecord[],
  options: BuildProductionJourneyOptions = {}
): ProductionJourney {
  const sorted = [...records].sort(
    (a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime()
  );

  const limit = Math.min(
    options.limit ?? JOURNEY_CONFIG.defaultTimelineLimit,
    JOURNEY_CONFIG.maxTimelineLimit
  );
  const offset = options.offset ?? 0;
  const paged = sorted.slice(Math.max(0, sorted.length - limit - offset), sorted.length - offset);

  const timeline = paged.map(toTimelinePoint);
  const validTimeline = timeline.filter((p) => isValidJourneyVerdict(p.status, p.score));
  const latest = timeline[timeline.length - 1] ?? null;
  const previous = timeline.length > 1 ? timeline[timeline.length - 2] : null;
  const latestValid = validTimeline[validTimeline.length - 1] ?? null;
  const previousValid =
    validTimeline.length > 1 ? validTimeline[validTimeline.length - 2] : null;

  const scores = validTimeline
    .map((p) => p.score)
    .filter((s): s is number => s !== null);

  const blockersIntroduced = timeline.reduce((sum, p) => sum + p.introducedBlockersCount, 0);
  const blockersResolved = timeline.reduce((sum, p) => sum + p.resolvedBlockersCount, 0);

  const trend = calculateTrend(timeline);
  const milestones = detectMilestones(timeline);

  const latestRecord = sorted[sorted.length - 1] ?? null;
  const previousRecord = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const { focusKey } = determineCurrentFocus(latestRecord?.verdict ?? null);

  const maturity = calculateMaturity({
    validReviews: validTimeline.length,
    currentStatus: latest?.status ?? null,
    currentPosture: latest?.deploymentPosture ?? null,
    currentScore: latest?.score ?? null,
    trend,
    blockersResolved,
    timeline,
  });

  const bestScore = scores.length > 0 ? Math.max(...scores) : null;
  const lowestScore = scores.length > 0 ? Math.min(...scores) : null;
  const bestPoint = validTimeline.find((p) => p.score === bestScore) ?? null;

  const latestVerdict = latestRecord?.verdict ?? null;
  const introducedTitles =
    (latest?.introducedBlockersCount ?? 0) > 0
      ? (latestVerdict?.topPriorities.map((p) => p.title).slice(0, 5) ?? [])
      : [];

  const resolvedTitles: string[] = [];
  if ((latest?.resolvedBlockersCount ?? 0) > 0 && previousRecord?.verdict) {
    const prevIds = new Set(
      previousRecord.verdict.topPriorities.flatMap((p) => p.findingIds)
    );
    for (const priority of latestVerdict?.topPriorities ?? []) {
      if (priority.findingIds.every((id) => !prevIds.has(id))) continue;
    }
    if (latestVerdict && latest.resolvedBlockersCount > 0) {
      resolvedTitles.push(
        ...previousRecord.verdict.topPriorities
          .filter((p) => !latestVerdict.topPriorities.some((c) => c.id === p.id))
          .map((p) => p.title)
          .slice(0, 5)
      );
    }
  }

  const journey: ProductionJourney = {
    version: JOURNEY_CONFIG.version,
    projectId: latestRecord?.projectId ?? sorted[0]?.projectId ?? "00000000-0000-0000-0000-000000000000",
    repositoryId:
      latestRecord?.repositoryId ?? sorted[0]?.repositoryId ?? "00000000-0000-0000-0000-000000000000",

    currentScore: latest?.score ?? null,
    previousScore: previousValid?.score ?? previous?.score ?? null,
    bestScore,
    lowestScore,

    currentStatus: latest?.status ?? null,
    currentDeploymentPosture: latest?.deploymentPosture ?? null,
    previousStatus: previous?.status ?? null,
    bestStatus: bestStatusFromTimeline(timeline),

    totalReviews: timeline.length,
    validReviews: validTimeline.length,
    completedReviews: timeline.filter((p) => p.status !== "analysis_failed").length,
    failedReviews: timeline.filter((p) => p.status === "analysis_failed").length,

    blockersResolved,
    blockersIntroduced,
    currentBlockers: latest?.blockersCount ?? 0,
    netBlockerImprovement: blockersResolved - blockersIntroduced,

    scoreChange7d: calculateScoreChange(timeline, 7),
    scoreChange30d: calculateScoreChange(timeline, 30),

    currentFocus: null,
    currentFocusKey: focusKey,
    currentMilestone: milestones[milestones.length - 1] ?? null,
    nextMilestoneKey: nextMilestoneKey(milestones),

    firstReviewedAt: timeline[0]?.generatedAt ?? null,
    lastReviewedAt: latest?.generatedAt ?? null,
    bestScoreAt: bestPoint?.generatedAt ?? null,

    trend,
    maturity,

    timeline,
    milestones,
    highlights: buildHighlights(milestones, latest),
    areasProgress: buildAreasProgress(
      previousRecord?.verdict ?? null,
      latestRecord?.verdict ?? null
    ),

    latestIntroducedTitles: introducedTitles,
    latestResolvedTitles: resolvedTitles,
    skippedInvalidVerdicts: 0,
  };

  return ProductionJourneySchema.parse(journey);
}

export function toJourneyPreview(journey: ProductionJourney) {
  const latest = journey.timeline[journey.timeline.length - 1];
  return {
    projectId: journey.projectId,
    currentScore: journey.currentScore,
    previousScore: journey.previousScore,
    bestScore: journey.bestScore,
    scoreChange7d: journey.scoreChange7d,
    trend: journey.trend,
    maturity: journey.maturity,
    currentDeploymentPosture: journey.currentDeploymentPosture,
    currentFocusKey: journey.currentFocusKey,
    currentMilestone: journey.currentMilestone,
    latestIntroducedTitles: journey.latestIntroducedTitles,
    latestResolvedTitles: journey.latestResolvedTitles,
    validReviews: journey.validReviews,
    latestScoreDelta: latest?.scoreDelta ?? null,
  };
}
