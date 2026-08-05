import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import { isFeatureEnabled } from "@/server/feature-flags";
import { listAnalysisRunsForProject } from "@/server/analysis-runs/list-analysis-runs";
import { getProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { getSecurityTestContext } from "@/server/attack-simulation/get-security-test-context";
import { getProtectionCenterModel } from "@/server/continuous-protection/protection-context";
import { loadMissionControlWithRecovery } from "./load-mission-control-with-recovery";
import { buildMissionControlState } from "./build-mission-control-state";
import { fixPromptContextFromScan } from "@/features/production-verdict/fix-prompt-context";
import { loadAnalysisRunFindingsForFixPrompt } from "@/server/analysis-runs/load-run-findings-for-fix";

export async function loadFullMissionControlState(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    organizationId: string;
    admin: SupabaseClient | null;
    analysisRunId: string | null;
    manualRecovery?: boolean;
    openTechnicalDetails?: boolean;
  }
): Promise<MissionControlState | null> {
  const { projectId, organizationId, admin } = input;
  const manualRecovery = input.manualRecovery ?? false;

  const isolationEnabled = isFeatureEnabled("analysis_run_isolation", { organizationId });
  const attackCenterEnabled = isFeatureEnabled("attack_simulation", { organizationId });
  const continuousProtectionEnabled = isFeatureEnabled("continuous_protection", { organizationId });

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, framework")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return null;

  const analysisRuns =
    isolationEnabled && admin
      ? await listAnalysisRunsForProject(admin, { projectId, organizationId }).catch(() => [])
      : [];

  const missionLoad = await loadMissionControlWithRecovery(supabase, projectId, organizationId, {
    analysisRunId: input.analysisRunId,
    isolationEnabled,
    manualRecovery,
    admin,
  });

  const { verdict, runScoped, activeRunId } = missionLoad;
  const findingsRunId = runScoped && activeRunId ? activeRunId : null;

  let reviewContext = null;
  try {
    reviewContext = await getProjectReviewUiContext(supabase, projectId, {
      analysisRunId: isolationEnabled ? activeRunId : null,
      analysisRuns,
      scopedVerdictGeneratedAt: verdict?.generatedAt ?? null,
    });
  } catch {
    reviewContext = null;
  }

  const scanForContext = findingsRunId
    ? await supabase
        .from("scans")
        .select("id, detected_stack, status")
        .eq("id", findingsRunId)
        .eq("project_id", projectId)
        .maybeSingle()
    : await supabase
        .from("scans")
        .select("id, detected_stack, status")
        .eq("project_id", projectId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const runFindings =
    isolationEnabled && findingsRunId
      ? await loadAnalysisRunFindingsForFixPrompt(supabase, findingsRunId)
      : undefined;

  const latestReportHref =
    scanForContext.data?.id &&
    (scanForContext.data.status === "completed" || !isolationEnabled)
      ? `/projects/${projectId}/scans/${scanForContext.data.id}/report`
      : undefined;

  const fixPromptContext = verdict
    ? fixPromptContextFromScan({
        projectName: project.name,
        detectedStack: scanForContext.data?.detected_stack,
        framework: project.framework,
        findings: runFindings,
        currentVerdictStatus: verdict.status,
        currentScore: verdict.score,
      })
    : undefined;

  let securityTestContext = null;
  if (attackCenterEnabled && reviewContext && admin) {
    try {
      const fullContext = await getSecurityTestContext(admin, {
        projectId,
        organizationId,
        analysisRunId: runScoped && activeRunId ? activeRunId : undefined,
        isolationEnabled,
      });
      const { hypotheses: _h, analysisRunId: _r, ...publicContext } = fullContext;
      securityTestContext = publicContext;
    } catch {
      securityTestContext = null;
    }
  }

  const showProtectionStatus =
    continuousProtectionEnabled && Boolean(verdict) && !manualRecovery;

  const protectionCenter =
    showProtectionStatus && admin
      ? await getProtectionCenterModel(admin, projectId).catch(() => null)
      : null;

  return buildMissionControlState({
    projectId,
    projectName: project.name,
    framework: project.framework ?? null,
    missionLoad,
    analysisRuns,
    reviewContext,
    securityTestContext,
    protectionCenter,
    fixPromptContext,
    reportHref: latestReportHref,
    flags: {
      analysisRunIsolationEnabled: isolationEnabled,
      attackCenterEnabled,
      continuousProtectionEnabled,
      manualRecovery,
    },
    ui: {
      openTechnicalDetails: input.openTechnicalDetails ?? false,
    },
  });
}
