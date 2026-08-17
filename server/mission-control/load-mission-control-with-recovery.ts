import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { MissionControlView } from "@/features/mission-control/types";
import {
  getCurrentProductionVerdict,
  getProductionVerdictByScan,
} from "@/server/production-verdict/service";
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
 * 1. Resolve scoped verdict first (cheap lookup)
 * 2. Load scoped Mission Control view only when scoped verdict exists
 * 3. Fall back to current production verdict + unscoped view when scoped run has no verdict
 * 4. Empty scoped state when neither exists
 */
export async function loadMissionControlWithRecovery(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string,
  input: LoadInput
): Promise<MissionControlLoadResult> {
  const dataClient = input.admin ?? supabase;
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

  const scopedVerdict = await getProductionVerdictByScan(dataClient, scopedRunId);
  if (scopedVerdict) {
    const scoped = await getMissionControlView(supabase, projectId, organizationId, {
      analysisRunId: scopedRunId,
      admin: input.admin,
      preloadedVerdict: scopedVerdict,
    });
    return {
      view: scoped.view,
      verdict: scoped.verdict,
      runScoped: true,
      activeRunId: scopedRunId,
      recoveryReason: null,
    };
  }

  const currentVerdict = await getCurrentProductionVerdict(dataClient, projectId);
  if (currentVerdict) {
    console.info({
      component: "mission-control-recovery",
      event: "fallback_to_current_verdict",
      projectId,
      requestedRunId: scopedRunId,
    });
    const unscoped = await getMissionControlView(supabase, projectId, organizationId, {
      admin: input.admin,
      preloadedVerdict: currentVerdict,
    });
    return {
      view: unscoped.view,
      verdict: unscoped.verdict,
      runScoped: false,
      activeRunId: scopedRunId,
      recoveryReason: "scoped_verdict_missing",
    };
  }

  const scoped = await getMissionControlView(supabase, projectId, organizationId, {
    analysisRunId: scopedRunId,
    admin: input.admin,
    preloadedVerdict: null,
  });
  return {
    view: scoped.view,
    verdict: null,
    runScoped: true,
    activeRunId: scopedRunId,
    recoveryReason: null,
  };
}
