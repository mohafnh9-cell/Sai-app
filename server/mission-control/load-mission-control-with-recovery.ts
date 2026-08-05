import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { MissionControlView } from "@/features/mission-control/types";
import { getMissionControlView } from "./get-mission-control";

export type MissionControlRecoveryReason =
  | "scoped_verdict_missing"
  | "manual_recovery"
  | null;

export type MissionControlLoadResult = {
  view: MissionControlView;
  verdict: ProductionVerdictV1 | null;
  /** True when verdict/view reflect the requested analysis run. */
  runScoped: boolean;
  /** Run id shown in the selector (may differ from scoped load when recovering). */
  activeRunId: string | null;
  recoveryReason: MissionControlRecoveryReason;
};

type LoadInput = {
  analysisRunId: string | null;
  isolationEnabled: boolean;
  manualRecovery: boolean;
  admin: SupabaseClient | null;
};

/**
 * Recovery ladder:
 * 1. Requested analysis run (scoped)
 * 2. Current production verdict (unscoped) when scoped run has no verdict
 * 3. Empty state from scoped loader when neither exists
 */
export async function loadMissionControlWithRecovery(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string,
  input: LoadInput
): Promise<MissionControlLoadResult> {
  const scopedRunId =
    input.isolationEnabled && input.analysisRunId && !input.manualRecovery
      ? input.analysisRunId
      : null;

  if (!scopedRunId) {
    const unscoped = await getMissionControlView(supabase, projectId, organizationId, {
      admin: input.admin,
    });
    return {
      view: unscoped.view,
      verdict: unscoped.verdict,
      runScoped: false,
      activeRunId: input.manualRecovery ? null : input.analysisRunId,
      recoveryReason: input.manualRecovery ? "manual_recovery" : null,
    };
  }

  const scoped = await getMissionControlView(supabase, projectId, organizationId, {
    analysisRunId: scopedRunId,
    admin: input.admin,
  });

  if (scoped.verdict) {
    return {
      view: scoped.view,
      verdict: scoped.verdict,
      runScoped: true,
      activeRunId: scopedRunId,
      recoveryReason: null,
    };
  }

  const unscoped = await getMissionControlView(supabase, projectId, organizationId, {
    admin: input.admin,
  });

  if (unscoped.verdict) {
    console.info({
      component: "mission-control-recovery",
      event: "fallback_to_current_verdict",
      projectId,
      requestedRunId: scopedRunId,
    });
    return {
      view: unscoped.view,
      verdict: unscoped.verdict,
      runScoped: false,
      activeRunId: scopedRunId,
      recoveryReason: "scoped_verdict_missing",
    };
  }

  return {
    view: scoped.view,
    verdict: null,
    runScoped: true,
    activeRunId: scopedRunId,
    recoveryReason: null,
  };
}
