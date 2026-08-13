import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import {
  type OnboardingContext,
  type OnboardingProject,
  type OnboardingScan,
  scanIsActive,
  scanIsCompleted,
} from "@/features/onboarding/onboarding-flow";
import { getWorkspaceGitHubConnectionView } from "@/server/github/workspace-connection-service";
import { organizationHasActiveSubscription } from "@/server/billing/subscription-status";
import { resolveActiveWorkspaceIdForUser } from "@/server/workspaces/service";

function mapScan(row: {
  id: string;
  project_id: string;
  status: string;
  progress: number | null;
  progress_message: string | null;
}): OnboardingScan {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    progress: row.progress,
    progressMessage: row.progress_message,
  };
}

export async function getOnboardingContext(
  supabase: SupabaseClient,
  userId: string
): Promise<OnboardingContext> {
  const orgId = await resolveActiveWorkspaceIdForUser(supabase, userId);
  const hasOrg = Boolean(orgId);

  const hasActiveSubscription = orgId
    ? await organizationHasActiveSubscription(supabase, orgId)
    : false;

  const githubConnected = orgId
    ? (await getWorkspaceGitHubConnectionView(supabase, orgId)).status === "connected"
    : false;

  let projects: OnboardingProject[] = [];
  let activeScan: OnboardingScan | null = null;
  let latestCompletedScan: OnboardingScan | null = null;
  let latestVerdict: ProductionVerdictV1 | null = null;
  let isComplete = false;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.user_metadata && typeof user.user_metadata.onboarding_wizard_completed_at === "string") {
    isComplete = true;
  }

  if (orgId) {
    const { data: projectRows } = await supabase
      .from("projects")
      .select("id, name, github_repo, github_default_branch, github_is_private, updated_at, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    projects = (projectRows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      githubRepo: row.github_repo,
      defaultBranch: row.github_default_branch,
      isPrivate: row.github_is_private,
      updatedAt: row.updated_at ?? row.created_at,
    }));

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length > 0) {
      const { data: scans } = await supabase
        .from("scans")
        .select("id, project_id, status, progress, progress_message, created_at")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false })
        .limit(10);

      for (const scan of scans ?? []) {
        if (!activeScan && scanIsActive(scan.status)) {
          activeScan = mapScan(scan);
        }
        if (!latestCompletedScan && scanIsCompleted(scan.status)) {
          latestCompletedScan = mapScan(scan);
        }
      }
    }

    const scanIdForVerdict = latestCompletedScan?.id ?? activeScan?.id;
    if (scanIdForVerdict) {
      const { data: verdictRow } = await supabase
        .from("production_verdicts")
        .select("verdict")
        .eq("scan_id", scanIdForVerdict)
        .maybeSingle();

      if (verdictRow?.verdict) {
        latestVerdict = verdictRow.verdict as ProductionVerdictV1;
      }
    }

    if (!latestVerdict && isComplete) {
      const { data: latestVerdictRow } = await supabase
        .from("production_verdicts")
        .select("verdict, scan_id")
        .eq("organization_id", orgId)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestVerdictRow?.verdict) {
        latestVerdict = latestVerdictRow.verdict as ProductionVerdictV1;
        if (!latestCompletedScan && latestVerdictRow.scan_id) {
          const { data: scanRow } = await supabase
            .from("scans")
            .select("id, project_id, status, progress, progress_message")
            .eq("id", latestVerdictRow.scan_id)
            .maybeSingle();
          if (scanRow) latestCompletedScan = mapScan(scanRow);
        }
      }
    }
  }

  return {
    hasOrg,
    orgId,
    hasActiveSubscription,
    githubConnected,
    projects,
    activeScan,
    latestCompletedScan,
    latestVerdict,
    isComplete,
  };
}
