import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAutopilotDashboardView,
  type AutopilotDashboardView,
} from "@/brain/autopilot-experience";
import { mapScanStatusToReviewStatus } from "@/brain/automatic-review";
import { buildRepositoryStatusView } from "@/brain/repository-sync";
import {
  getCurrentProductionVerdictsForProjects,
  getProductionVerdictScanIds,
} from "@/server/production-verdict/service";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { isVerdictAutopilotEnabled } from "./is-enabled";

const ACTIVE_SCAN_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
] as const;

type AutomaticReviewRow = {
  id: string;
  repository_id: string;
  status: string;
  completed_at: string | null;
  failed_at: string | null;
  created_at: string;
};

function latestAutomaticReviewByProject(
  rows: AutomaticReviewRow[]
): Map<string, AutomaticReviewRow> {
  const latest = new Map<string, AutomaticReviewRow>();
  for (const row of rows) {
    if (!latest.has(row.repository_id)) {
      latest.set(row.repository_id, row);
    }
  }
  return latest;
}

export async function getAutopilotDashboardView(
  supabase: SupabaseClient,
  organizationId: string
): Promise<AutopilotDashboardView> {
  const orgAutopilotEnabled = await isVerdictAutopilotEnabled(supabase, organizationId);

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, github_repo, github_repository_id, webhook_enabled")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  if (!projects?.length) {
    return buildAutopilotDashboardView({ orgAutopilotEnabled, projects: [] });
  }

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }

  const projectIds = projects.map((project) => project.id);
  const dataClient = admin ?? supabase;

  const [webhookResult, automaticReviewResult, activeScanResult, currentVerdicts] =
    await Promise.all([
      supabase.from("github_webhooks").select("project_id, active").in("project_id", projectIds),
      supabase
        .from("scans")
        .select("id, repository_id, status, completed_at, failed_at, created_at, review_type")
        .in("repository_id", projectIds)
        .eq("review_type", "automatic")
        .order("created_at", { ascending: false }),
      admin
        ? admin
            .from("scans")
            .select("id, repository_id")
            .in("repository_id", projectIds)
            .in("status", [...ACTIVE_SCAN_STATUSES])
        : Promise.resolve({ data: [] as Array<{ id: string; repository_id: string }>, error: null }),
      getCurrentProductionVerdictsForProjects(dataClient, organizationId, projectIds),
    ]);

  const webhooksByProject = new Map(
    (webhookResult.data ?? []).map((row) => [row.project_id as string, row])
  );
  const latestReviewByProject = latestAutomaticReviewByProject(
    (automaticReviewResult.data ?? []) as AutomaticReviewRow[]
  );
  const activeScanProjects = new Set(
    (activeScanResult.data ?? []).map((row) => row.repository_id as string)
  );

  const completedReviewScanIds = [...latestReviewByProject.values()]
    .filter((review) => mapScanStatusToReviewStatus(review.status) === "completed")
    .map((review) => review.id);
  const verdictScanIds = await getProductionVerdictScanIds(
    dataClient,
    organizationId,
    completedReviewScanIds
  );

  const projectInputs = projects.map((project) => {
    const webhookRow = webhooksByProject.get(project.id);
    const latestReview = latestReviewByProject.get(project.id);
    const connection = buildRepositoryStatusView({
      githubRepo: project.github_repo,
      githubRepositoryId: project.github_repository_id,
      webhookEnabled: project.webhook_enabled,
      webhookActive: webhookRow?.active ?? null,
      hasWebhookRegistration: Boolean(webhookRow),
      hasOrganizationToken: true,
      lastError: null,
      detectedAt: null,
      branch: null,
      commitSha: null,
      commitMessage: null,
      pushedAt: null,
    });

    const reviewStatus = latestReview
      ? mapScanStatusToReviewStatus(latestReview.status)
      : null;
    const verdictUpdated =
      latestReview && reviewStatus === "completed"
        ? verdictScanIds.has(latestReview.id)
        : null;
    const verdict = currentVerdicts.get(project.id) ?? null;

    return {
      projectId: project.id,
      projectName: project.name,
      autopilotEnabled: orgAutopilotEnabled,
      repositoryConnected: connection.connectionStatus === "connected",
      repositoryWaitingForChanges: connection.display === "connected_waiting",
      hasActiveReview: activeScanProjects.has(project.id),
      latestAutomaticReviewStatus: reviewStatus,
      latestAutomaticReviewAt:
        latestReview?.completed_at ??
        latestReview?.failed_at ??
        latestReview?.created_at ??
        null,
      verdictUpdated,
      currentStatus: verdict?.status ?? null,
      scoreDelta: verdict?.scoreDelta ?? null,
    };
  });

  return buildAutopilotDashboardView({
    orgAutopilotEnabled,
    projects: projectInputs,
  });
}
