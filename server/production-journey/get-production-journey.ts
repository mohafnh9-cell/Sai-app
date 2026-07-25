import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProductionJourney,
  toJourneyPreview,
  type BuildProductionJourneyOptions,
  type ProductionJourney,
  type ProductionJourneyPreview,
  ProductionJourneySchema,
} from "@/brain/production-journey";
import { loadVerdictJourneyRecords } from "./load-verdicts";
import { getProjectAccessForUser } from "@/server/projects/project-access";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "production-journey-service", event, ...fields });
}

async function resolveProjectAccess(
  client: SupabaseClient,
  projectId: string,
  userId: string
) {
  return getProjectAccessForUser(client, projectId, userId);
}

export async function getProductionJourneyByProject(
  client: SupabaseClient,
  projectId: string,
  userId: string,
  options?: BuildProductionJourneyOptions
): Promise<ProductionJourney | null> {
  log("journey_requested", { projectId, userId });

  const project = await resolveProjectAccess(client, projectId, userId);
  if (!project) {
    log("journey_access_denied", { projectId, userId });
    return null;
  }

  try {
    const { records, skippedInvalid } = await loadVerdictJourneyRecords(
      client,
      projectId,
      { limit: 200 }
    );

    if (records.length === 0) {
      const empty = ProductionJourneySchema.parse({
        version: "1.0.0",
        projectId: project.id,
        repositoryId: project.id,
        currentScore: null,
        previousScore: null,
        bestScore: null,
        lowestScore: null,
        currentStatus: null,
        previousStatus: null,
        bestStatus: null,
        totalReviews: 0,
        validReviews: 0,
        completedReviews: 0,
        failedReviews: 0,
        blockersResolved: 0,
        blockersIntroduced: 0,
        currentBlockers: 0,
        netBlockerImprovement: 0,
        scoreChange7d: null,
        scoreChange30d: null,
        currentFocus: null,
        currentFocusKey: null,
        currentMilestone: null,
        nextMilestoneKey: "milestones.firstVerdict",
        firstReviewedAt: null,
        lastReviewedAt: null,
        bestScoreAt: null,
        trend: "insufficient_data",
        maturity: "unassessed",
        timeline: [],
        milestones: [],
        highlights: [],
        areasProgress: [],
        latestIntroducedTitles: [],
        latestResolvedTitles: [],
        skippedInvalidVerdicts: 0,
      });
      log("journey_built_empty", { projectId });
      return empty;
    }

    const journey = buildProductionJourney(records, options);
    journey.skippedInvalidVerdicts = skippedInvalid;
    journey.projectId = project.id;
    journey.repositoryId = project.id;

    log("journey_built", {
      projectId,
      validReviews: journey.validReviews,
      trend: journey.trend,
      milestones: journey.milestones.length,
    });

    return journey;
  } catch (cause) {
    log("journey_load_failed", {
      projectId,
      error: cause instanceof Error ? cause.message : "unknown",
    });
    return null;
  }
}

export async function getProductionJourney(
  client: SupabaseClient,
  repositoryId: string,
  userId: string,
  options?: BuildProductionJourneyOptions
): Promise<ProductionJourney | null> {
  return getProductionJourneyByProject(client, repositoryId, userId, options);
}

export async function getProductionJourneyPreviewByProject(
  client: SupabaseClient,
  projectId: string,
  userId: string
): Promise<ProductionJourneyPreview | null> {
  const journey = await getProductionJourneyByProject(client, projectId, userId, {
    limit: 30,
  });
  if (!journey) return null;
  return toJourneyPreview(journey);
}

export async function getProductionJourneyTimeline(
  client: SupabaseClient,
  repositoryId: string,
  userId: string,
  range?: { limit?: number; offset?: number }
) {
  const journey = await getProductionJourneyByProject(
    client,
    repositoryId,
    userId,
    range
  );
  return journey?.timeline ?? [];
}

export async function getProductionJourneyMilestones(
  client: SupabaseClient,
  repositoryId: string,
  userId: string
) {
  const journey = await getProductionJourneyByProject(client, repositoryId, userId);
  return journey?.milestones ?? [];
}
