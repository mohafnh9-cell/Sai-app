import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProtectionContext } from "@/server/continuous-protection/protection-context";
import {
  buildDeployBlockedCandidate,
  buildProtectionAlertCandidates,
  loadAlertEvaluationContext,
} from "./alert-engine";
import { autoResolveAlertsForProject, deliverAlertCandidate } from "./lifecycle";
import { passesMaterialGate } from "./noise-policy";
import { labelFromStorage } from "@/server/continuous-protection/types";

export type EvaluateAlertsResult = {
  candidates: number;
  delivered: number;
  suppressed: number;
  resolved: number;
};

export async function evaluateProjectAlerts(
  admin: SupabaseClient,
  projectId: string
): Promise<EvaluateAlertsResult> {
  const [ctx, evalCtx] = await Promise.all([
    loadProtectionContext(admin, projectId),
    loadAlertEvaluationContext(admin, projectId),
  ]);

  if (!ctx || !evalCtx) {
    return { candidates: 0, delivered: 0, suppressed: 0, resolved: 0 };
  }

  if (!ctx.hasSuccessfulReview) {
    return { candidates: 0, delivered: 0, suppressed: 0, resolved: 0 };
  }

  const latestStatus = ctx.latestSnapshotStatus;
  if (latestStatus === "protected") {
    const resolved = await autoResolveAlertsForProject(admin, projectId, "status_improved");
    if (resolved > 0) {
      return { candidates: 0, delivered: 0, suppressed: 0, resolved };
    }
  }

  const prodDrop =
    evalCtx.snapshots48h[0]?.production_confidence != null &&
    evalCtx.snapshots48h[1]?.production_confidence != null
      ? evalCtx.snapshots48h[1].production_confidence! -
        evalCtx.snapshots48h[0].production_confidence!
      : null;

  const hasMaterialEvent24h = evalCtx.events24h.some((e) =>
    ["material_change_detected", "dependency_snapshot", "protection_status_updated"].includes(
      e.type
    )
  );

  const materialOk = passesMaterialGate({
    hasMaterialEvent24h,
    statusRequiresAttention: ctx.latestSnapshotStatus === "requires_attention",
    openCritical: ctx.openCritical,
    confidenceDrop24h: prodDrop,
  });

  const candidates = buildProtectionAlertCandidates(ctx, evalCtx);
  const gated = materialOk ? candidates : candidates.filter((c) => c.alertKind === "watch_stale" || c.alertKind === "check_delayed" || c.alertKind === "github_disconnected" || c.alertKind === "protection_paused");

  let delivered = 0;
  let suppressed = 0;

  for (const candidate of gated) {
    const result = await deliverAlertCandidate(admin, {
      organizationId: ctx.organizationId,
      projectId,
      projectName: evalCtx.projectName,
      candidate,
    });
    if (result.delivered) delivered += 1;
    else suppressed += 1;
  }

  return { candidates: gated.length, delivered, suppressed, resolved: 0 };
}

export async function evaluateDeployCheckAlert(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    projectName: string;
    deployAnswer: "go" | "no_go" | "not_yet";
    primaryWorry: string | null;
  }
): Promise<void> {
  if (input.deployAnswer === "go") {
    return;
  }
  const candidate = buildDeployBlockedCandidate(
    input.projectId,
    input.projectName,
    input.primaryWorry
  );
  await deliverAlertCandidate(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectName: input.projectName,
    candidate,
  });
}

export async function listAlertEligibleProjects(admin: SupabaseClient): Promise<
  Array<{ projectId: string; organizationId: string }>
> {
  const { data: profiles } = await admin
    .from("project_memory_profile")
    .select("project_id, organization_id")
    .not("first_protected_at", "is", null)
    .limit(500);

  return (profiles ?? []).map((p) => ({
    projectId: p.project_id as string,
    organizationId: p.organization_id as string,
  }));
}

export async function getOpenAlertsForProject(
  admin: SupabaseClient,
  projectId: string,
  limit = 10
) {
  const { data } = await admin
    .from("security_alerts")
    .select("*")
    .eq("project_id", projectId)
    .in("state", ["delivered", "read"])
    .order("created_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}

export async function getProtectionStatusLabelForMcp(
  admin: SupabaseClient,
  projectId: string
): Promise<string | null> {
  const ctx = await loadProtectionContext(admin, projectId);
  if (!ctx?.latestSnapshotStatus) return null;
  return labelFromStorage(ctx.latestSnapshotStatus);
}
