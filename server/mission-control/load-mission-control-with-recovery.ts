import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { MissionControlView } from "@/features/mission-control/types";
import {
  getProductionVerdictByScan,
} from "@/server/production-verdict/service";
import { findPreviousCompletedScan } from "@/server/security-scanner/previous-scan";
import { getMissionControlView } from "./get-mission-control";
import {
  isVerdictMaterializing,
  newerScanAwaitingVerdict,
  VERDICT_MATERIALIZATION_WINDOW_MS,
} from "@/server/production-verdict/pending-verdict";

export type MissionControlRecoveryReason =
  | "scoped_verdict_missing"
  | "manual_recovery"
  /**
   * The scan has completed but its Production Verdict is still being written
   * (it lands a few seconds after the scan flips to "completed"). Bounded by
   * VERDICT_MATERIALIZATION_WINDOW_MS so polling can never be infinite.
   */
  | "verdict_materializing"
  | null;

export { VERDICT_MATERIALIZATION_WINDOW_MS, isVerdictMaterializing };

async function scanMaterializingVerdict(
  dataClient: SupabaseClient,
  projectId: string,
  scanId: string | null
): Promise<boolean> {
  if (scanId) {
    const { data } = await dataClient
      .from("scans")
      .select("status, completed_at")
      .eq("id", scanId)
      .eq("project_id", projectId)
      .maybeSingle();
    return isVerdictMaterializing(data as { status?: string; completed_at?: string } | null);
  }
  // No run id: the project's most recent completed default-branch scan.
  const latest = (await findPreviousCompletedScan(
    dataClient,
    { projectId, branch: null, excludeScanId: "" },
    "id, status, completed_at"
  )) as { status?: string; completed_at?: string } | null;
  return isVerdictMaterializing(latest);
}

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
 * A selected run only exposes its OWN verdict. A run without one stays pending (or empty once the
 * materialization window has elapsed): the project's previous verdict is never substituted, because it
 * belongs to an older scan. Project-wide recovery is available only through explicit manual recovery.
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
    // No verdict yet, OR a verdict that belongs to an OLDER scan while a newer completed scan is
    // still writing its own: the older verdict is history, not the current decision.
    const materializing =
      !input.manualRecovery &&
      (unscoped.verdict
        ? await newerScanAwaitingVerdict(dataClient, projectId, unscoped.verdict.scanId)
        : await scanMaterializingVerdict(dataClient, projectId, null));
    return {
      view: unscoped.view,
      verdict: unscoped.verdict,
      runScoped: false,
      activeRunId: input.manualRecovery ? null : input.analysisRunId,
      recoveryReason: input.manualRecovery ? "manual_recovery" : materializing ? "verdict_materializing" : null,
    };
  }

  const scopedVerdict = await getProductionVerdictByScan(dataClient, organizationId, scopedRunId);
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

  const scoped = await getMissionControlView(supabase, projectId, organizationId, {
    analysisRunId: scopedRunId,
    admin: input.admin,
    preloadedVerdict: null,
  });
  // First scan of a project: the scan can be completed while its verdict is still
  // being written. Without this, polling stopped here and the page stayed on
  // "no verdict yet" until a manual reload.
  const materializing = await scanMaterializingVerdict(dataClient, projectId, scopedRunId);
  return {
    view: scoped.view,
    verdict: null,
    runScoped: true,
    activeRunId: scopedRunId,
    recoveryReason: materializing ? "verdict_materializing" : null,
  };
}
