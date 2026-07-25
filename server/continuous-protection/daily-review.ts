import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadProtectionContext,
  recomputeAndPersistProtectionState,
} from "./protection-context";
import { appendCpEvent } from "./cp-memory-bridge";
import { runDependencyObservation } from "./dependency-observation";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "continuous-protection", event, ...fields });
}

const MS_DAY = 24 * 60 * 60 * 1000;

export async function ensureContinuousProtectionRow(
  admin: SupabaseClient,
  organizationId: string,
  projectId: string
): Promise<void> {
  await admin.from("project_continuous_protection").upsert(
    {
      project_id: projectId,
      organization_id: organizationId,
      enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );
}

export type DailyReviewResult =
  | { outcome: "skipped"; reason: string }
  | { outcome: "completed"; silent: boolean; status: string };

/** Daily protection review for one project (doc 02). */
export async function runDailyProtectionReview(
  admin: SupabaseClient,
  projectId: string
): Promise<DailyReviewResult> {
  const ctx = await loadProtectionContext(admin, projectId);
  if (!ctx) return { outcome: "skipped", reason: "project_not_found" };

  await ensureContinuousProtectionRow(admin, ctx.organizationId, projectId);

  if (!ctx.cpEnabled || ctx.cpPaused) {
    return { outcome: "skipped", reason: "cp_disabled" };
  }
  if (!ctx.githubConnected) {
    return { outcome: "skipped", reason: "github_disconnected" };
  }
  if (!ctx.hasSuccessfulReview) {
    return { outcome: "skipped", reason: "no_review_yet" };
  }

  const day = new Date().toISOString().slice(0, 10);

  const { data: projectRow } = await admin
    .from("projects")
    .select("github_repo")
    .eq("id", projectId)
    .maybeSingle();

  const { data: cpState } = await admin
    .from("project_continuous_protection")
    .select("lockfile_hash")
    .eq("project_id", projectId)
    .maybeSingle();

  try {
    const { data: sync } = await admin
      .from("repository_sync_status")
      .select("commit_sha")
      .eq("project_id", projectId)
      .maybeSingle();

    const remoteSha = sync?.commit_sha ?? null;
    const reviewedSha = ctx.verdict?.commitSha ?? null;
    const shaUnchanged = Boolean(remoteSha && reviewedSha && remoteSha === reviewedSha);

    if (shaUnchanged) {
      await appendCpEvent(admin, {
        organizationId: ctx.organizationId,
        projectId,
        type: "continuous_check_completed",
        idempotencyKey: `daily:check:${day}`,
        payload: { material: false, sha: remoteSha },
      });
    } else if (remoteSha && reviewedSha && remoteSha !== reviewedSha) {
      await appendCpEvent(admin, {
        organizationId: ctx.organizationId,
        projectId,
        type: "material_change_detected",
        idempotencyKey: `daily:material:${day}`,
        payload: {
          reasons: ["new_commit_detected"],
          previousSha: reviewedSha,
          newSha: remoteSha,
        },
      });
    }

    await appendCpEvent(admin, {
      organizationId: ctx.organizationId,
      projectId,
      type: "confidence_snapshot",
      idempotencyKey: `daily:confidence:${day}`,
      payload: {
        productionConfidence: ctx.productionConfidence,
        securityConfidence: ctx.securityConfidence,
      },
    });

    const dependency = await runDependencyObservation(
      admin,
      ctx,
      (projectRow?.github_repo as string | null) ?? null,
      remoteSha,
      (cpState?.lockfile_hash as string | null) ?? null
    );

    const status = await recomputeAndPersistProtectionState(admin, ctx, {
      materialChange: !shaUnchanged && Boolean(remoteSha),
      dependencyAdvisory: dependency.newCriticalAdvisory,
    });

    const { data: profile } = await admin
      .from("project_memory_profile")
      .select("first_protected_at")
      .eq("project_id", projectId)
      .maybeSingle();

    if (profile?.first_protected_at) {
      const protectedDays = Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(profile.first_protected_at as string).getTime()) / MS_DAY
        )
      );
      await admin
        .from("project_memory_profile")
        .update({ continuous_protection_days: protectedDays, updated_at: new Date().toISOString() })
        .eq("project_id", projectId);
    }

    await admin
      .from("project_continuous_protection")
      .update({
        last_daily_completed_at: new Date().toISOString(),
        consecutive_daily_failures: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("project_id", projectId);

    return { outcome: "completed", silent: shaUnchanged, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("daily_review_failed", { projectId, error: message });

    const failures = ctx.consecutiveDailyFailures + 1;
    await admin
      .from("project_continuous_protection")
      .update({
        consecutive_daily_failures: failures,
        updated_at: new Date().toISOString(),
      })
      .eq("project_id", projectId);

    throw error;
  }
}

export async function listDailyEligibleProjects(admin: SupabaseClient): Promise<
  Array<{ projectId: string; organizationId: string }>
> {
  const { data: profiles } = await admin
    .from("project_memory_profile")
    .select("project_id, organization_id, first_protected_at")
    .not("first_protected_at", "is", null)
    .limit(500);

  if (!profiles?.length) return [];

  const projectIds = profiles.map((p) => p.project_id as string);
  const { data: cpRows } = await admin
    .from("project_continuous_protection")
    .select("project_id, enabled, paused_at")
    .in("project_id", projectIds);

  const cpMap = new Map((cpRows ?? []).map((r) => [r.project_id as string, r]));

  return profiles
    .filter((p) => {
      const cp = cpMap.get(p.project_id as string);
      if (!cp) return true;
      return cp.enabled && !cp.paused_at;
    })
    .map((p) => ({
      projectId: p.project_id as string,
      organizationId: p.organization_id as string,
    }));
}
