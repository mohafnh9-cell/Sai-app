import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectMemorySummary } from "./types";

function isMissingMemoryTable(message: string): boolean {
  return message.includes("project_memory_profile") && message.includes("does not exist");
}

export async function getProjectMemorySummary(
  admin: SupabaseClient,
  projectId: string
): Promise<ProjectMemorySummary | null> {
  const { data: profile, error } = await admin
    .from("project_memory_profile")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    if (isMissingMemoryTable(error.message)) return null;
    return null;
  }

  if (!profile) return null;

  const { count: openRecs } = await admin
    .from("protection_recommendations")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "open");

  const { data: snapshots } = await admin
    .from("protection_snapshots")
    .select("snapshot_date, production_confidence, security_confidence, health_score")
    .eq("project_id", projectId)
    .order("snapshot_date", { ascending: false })
    .limit(8);

  const firstProtected = profile.first_protected_at as string | null;
  const protectedDays =
    profile.continuous_protection_days ??
    (firstProtected
      ? Math.max(
          0,
          Math.floor((Date.now() - new Date(firstProtected).getTime()) / (24 * 60 * 60 * 1000))
        )
      : 0);

  let healthTrend: ProjectMemorySummary["healthTrend"] = "insufficient_data";
  if (snapshots && snapshots.length >= 2) {
    const latest = snapshots[0]?.production_confidence;
    const prior = snapshots[snapshots.length - 1]?.production_confidence;
    if (latest != null && prior != null) {
      if (latest - prior >= 5) healthTrend = "improving";
      else if (latest - prior <= -5) healthTrend = "needs_attention";
      else healthTrend = "stable";
    }
  } else if (snapshots?.length === 1) {
    healthTrend = "stable";
  }

  const prodDelta = profile.lifetime_production_confidence_delta as number | null;
  const secDelta = profile.lifetime_security_confidence_delta as number | null;

  let headline = "SequrAI is building memory for this application.";
  if (protectedDays > 0) {
    if (healthTrend === "improving") {
      headline = "Your application is healthier than when SequrAI first protected it.";
    } else if (healthTrend === "needs_attention") {
      headline = "SequrAI is watching — production confidence dipped recently.";
    } else {
      headline = `SequrAI has been protecting this application for ${protectedDays} days.`;
    }
  }

  return {
    projectId,
    protectedDays,
    protectionStartedAt: firstProtected,
    productionConfidenceDeltaPercent: prodDelta,
    securityConfidenceDeltaPercent: secDelta,
    criticalIssuesFixed: profile.total_critical_fixed ?? 0,
    unsafeDeploymentsPrevented: profile.total_unsafe_prevented ?? 0,
    openRecommendations: openRecs ?? 0,
    healthTrend,
    headline,
    stackFingerprint: (profile.stack_fingerprint as string[]) ?? [],
  };
}
