import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProductionIntelligence,
  toIntelligencePreview,
  type ProductionIntelligence,
  type ProductionIntelligencePreview,
} from "@/brain/production-intelligence";
import { getProductionJourneyByProject } from "@/server/production-journey/service";
import { getProjectAccessForUser } from "@/server/projects/project-access";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "production-intelligence-service", event, ...fields });
}

export async function getProductionIntelligence(
  client: SupabaseClient,
  projectId: string,
  userId: string
): Promise<ProductionIntelligence | null> {
  log("intelligence_requested", { projectId, userId });

  try {
    const project = await getProjectAccessForUser(client, projectId, userId);
    if (!project) {
      log("intelligence_access_denied", { projectId });
      return null;
    }

    const journey = await getProductionJourneyByProject(client, projectId, userId, {
      limit: 50,
    });
    if (!journey) {
      log("intelligence_access_denied", { projectId });
      return null;
    }

    const verdict = await getCurrentProductionVerdict(
      client,
      project.organization_id,
      projectId
    );
    const intelligence = buildProductionIntelligence({ journey, verdict });

    log("intelligence_built", {
      projectId,
      momentum: intelligence.momentum,
      emptyState: intelligence.emptyState,
    });

    return intelligence;
  } catch (cause) {
    log("intelligence_load_failed", {
      projectId,
      error: cause instanceof Error ? cause.message : "unknown",
    });
    return null;
  }
}

export async function getProductionIntelligencePreview(
  client: SupabaseClient,
  projectId: string,
  userId: string
): Promise<ProductionIntelligencePreview | null> {
  const intelligence = await getProductionIntelligence(client, projectId, userId);
  if (!intelligence) return null;
  return toIntelligencePreview(intelligence);
}
