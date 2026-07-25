import "server-only";

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { appendProtectionEvent, ensureProjectMemoryProfile, snapshotContentHash } from "./append-event";
import {
  compositeHealthScore,
  deployAnswerFromVerdictStatus,
  healthLabelFromScore,
  protectionStatusFromVerdict,
  type DeployAnswer,
  type HealthLabel,
  type ProtectionHealth,
  type ProtectionStatus,
} from "./types";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "production-memory", event, ...fields });
}

function isMissingMemoryTable(message: string): boolean {
  return (
    message.includes("protection_snapshots") ||
    message.includes("project_memory_profile") ||
    message.includes("does not exist")
  );
}

export type SnapshotWriteInput = {
  organizationId: string;
  projectId: string;
  verdict: ProductionVerdictV1;
  verdictRowId: string | null;
  securityConfidence: number | null;
  stackLabels?: string[];
};

function productionHealthFromConfidence(score: number | null): HealthLabel {
  return healthLabelFromScore(score, "protected");
}

function securityHealthFromConfidence(score: number | null): HealthLabel {
  return healthLabelFromScore(score, "protected");
}

function protectionHealthFromStatus(status: ProtectionStatus): ProtectionHealth {
  switch (status) {
    case "protected":
      return "strong";
    case "safe_with_caution":
      return "steady";
    case "requires_attention":
      return "at_risk";
    default:
      return "unwatched";
  }
}

export async function upsertProtectionSnapshot(
  admin: SupabaseClient,
  input: SnapshotWriteInput
): Promise<void> {
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const productionConfidence = input.verdict.score;
  const securityConfidence = input.securityConfidence;
  const protectionStatus = protectionStatusFromVerdict(input.verdict.status);
  const deployAnswer = deployAnswerFromVerdictStatus(input.verdict.status);
  const healthScore = compositeHealthScore(productionConfidence, securityConfidence);
  const healthLabel = healthLabelFromScore(healthScore, protectionStatus);
  const worries = input.verdict.topPriorities.slice(0, 3).map((p) => p.title);
  const openCriticalHigh = input.verdict.criticalBlockersCount + input.verdict.highBlockersCount;

  const contentHash = snapshotContentHash({
    deployAnswer,
    productionConfidence,
    securityConfidence,
    healthScore,
    worries,
    openCriticalHigh,
  });

  const row = {
    organization_id: input.organizationId,
    project_id: input.projectId,
    snapshot_date: snapshotDate,
    production_confidence: productionConfidence,
    security_confidence: securityConfidence,
    health_score: healthScore,
    health_label: healthLabel,
    protection_status: protectionStatus,
    protection_health: protectionHealthFromStatus(protectionStatus),
    production_health: productionHealthFromConfidence(productionConfidence),
    security_health: securityHealthFromConfidence(securityConfidence),
    deploy_answer: deployAnswer,
    worries_top3: worries,
    open_critical_high_count: openCriticalHigh,
    content_hash: contentHash,
    source_verdict_id: input.verdictRowId,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("protection_snapshots")
    .upsert(row, { onConflict: "project_id,snapshot_date" });

  if (error) {
    if (isMissingMemoryTable(error.message)) return;
    log("snapshot_upsert_failed", { projectId: input.projectId, error: error.message });
  }
}

export async function touchProfileAfterReview(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    verdict: ProductionVerdictV1;
    stackLabels?: string[];
  }
): Promise<void> {
  await ensureProjectMemoryProfile(admin, input.organizationId, input.projectId);

  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from("project_memory_profile")
    .select("first_protected_at, stack_fingerprint")
    .eq("project_id", input.projectId)
    .maybeSingle();

  const firstProtected = existing?.first_protected_at ?? now;
  const stack =
    input.stackLabels && input.stackLabels.length > 0
      ? input.stackLabels
      : (existing?.stack_fingerprint as string[] | null) ?? [];

  const { data: firstSnapshot } = await admin
    .from("protection_snapshots")
    .select("production_confidence, security_confidence")
    .eq("project_id", input.projectId)
    .order("snapshot_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: latestSnapshot } = await admin
    .from("protection_snapshots")
    .select("production_confidence, security_confidence")
    .eq("project_id", input.projectId)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lifetimeProdDelta =
    firstSnapshot?.production_confidence != null && latestSnapshot?.production_confidence != null
      ? latestSnapshot.production_confidence - firstSnapshot.production_confidence
      : null;

  const lifetimeSecDelta =
    firstSnapshot?.security_confidence != null && latestSnapshot?.security_confidence != null
      ? latestSnapshot.security_confidence - firstSnapshot.security_confidence
      : null;

  const protectedDays = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(firstProtected).getTime()) / (24 * 60 * 60 * 1000)
    )
  );

  const { error } = await admin.from("project_memory_profile").upsert(
    {
      project_id: input.projectId,
      organization_id: input.organizationId,
      first_protected_at: firstProtected,
      stack_fingerprint: stack,
      continuous_protection_days: protectedDays,
      lifetime_production_confidence_delta: lifetimeProdDelta,
      lifetime_security_confidence_delta: lifetimeSecDelta,
      last_material_change_at: now,
      updated_at: now,
    },
    { onConflict: "project_id" }
  );

  if (error && !isMissingMemoryTable(error.message)) {
    log("profile_touch_failed", { projectId: input.projectId, error: error.message });
  }
}

export async function maybeRecordFirstProtectedMilestone(
  admin: SupabaseClient,
  organizationId: string,
  projectId: string
): Promise<void> {
  const idempotencyKey = "milestone:first_protected";
  const { error } = await admin.from("protection_milestones").insert({
    organization_id: organizationId,
    project_id: projectId,
    milestone_type: "first_protected",
    title_plain: "SequrAI started protecting this application.",
    payload: {},
    idempotency_key: idempotencyKey,
  });

  if (error) {
    if (error.code === "23505") return;
    if (isMissingMemoryTable(error.message)) return;
    log("milestone_failed", { projectId, error: error.message });
  } else {
    await appendProtectionEvent(admin, {
      organizationId,
      projectId,
      type: "protection_milestone_reached",
      idempotencyKey,
      payload: { milestoneType: "first_protected" },
    });
  }
}

export function stackLabelsFromDetectedStack(detectedStack: unknown): string[] {
  if (!detectedStack || typeof detectedStack !== "object") return [];
  const stack = detectedStack as Record<string, unknown>;
  const labels: string[] = [];
  if (typeof stack.framework === "string") labels.push(stack.framework.toLowerCase());
  if (stack.payments === true) labels.push("stripe");
  if (stack.auth === true) labels.push("auth");
  if (stack.database === true) labels.push("database");
  return labels.slice(0, 8);
}

export type RecordReviewMemoryInput = {
  organizationId: string;
  projectId: string;
  scanId: string;
  scanJobId?: string | null;
  verdict: ProductionVerdictV1;
  verdictRowId: string | null;
  securityScore: number | null;
  detectedStack?: unknown;
  trigger?: "mcp" | "web" | "github_push" | "scheduler";
};

/** Called after a production verdict is persisted — events + snapshot + profile. */
export async function recordReviewCompletedMemory(
  admin: SupabaseClient,
  input: RecordReviewMemoryInput
): Promise<void> {
  const stackLabels = stackLabelsFromDetectedStack(input.detectedStack);
  const deployAnswer = deployAnswerFromVerdictStatus(input.verdict.status);
  const worries = input.verdict.topPriorities.slice(0, 3).map((p) => p.title);

  await appendProtectionEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "protection_review_completed",
    scanId: input.scanId,
    scanJobId: input.scanJobId ?? null,
    idempotencyKey: `review_completed:${input.scanId}`,
    payload: {
      sha: input.verdict.commitSha,
      branch: input.verdict.branch,
      deployAnswer,
      trigger: input.trigger ?? "web",
    },
  });

  await appendProtectionEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "verdict_created",
    scanId: input.scanId,
    idempotencyKey: `verdict_created:${input.scanId}`,
    payload: {
      verdictId: input.verdictRowId,
      deployAnswer,
      productionConfidence: input.verdict.score,
      securityConfidence: input.securityScore,
      worriesTop3: worries,
    },
  });

  await appendProtectionEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "confidence_snapshot",
    scanId: input.scanId,
    idempotencyKey: `confidence_snapshot:${input.scanId}`,
    payload: {
      productionConfidence: input.verdict.score,
      securityConfidence: input.securityScore,
      deployAnswer,
    },
  });

  await upsertProtectionSnapshot(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    verdict: input.verdict,
    verdictRowId: input.verdictRowId,
    securityConfidence: input.securityScore,
    stackLabels,
  });

  await touchProfileAfterReview(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    verdict: input.verdict,
    stackLabels,
  });

  await maybeRecordFirstProtectedMilestone(admin, input.organizationId, input.projectId);
}

export async function recordReviewStartedMemory(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string | null;
    trigger: "mcp" | "web" | "github_push" | "scheduler";
    reason?: string;
  }
): Promise<void> {
  if (!input.scanId) return;
  await ensureProjectMemoryProfile(admin, input.organizationId, input.projectId);
  await appendProtectionEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "protection_review_started",
    scanId: input.scanId,
    idempotencyKey: `review_started:${input.scanId}`,
    payload: { trigger: input.trigger, reason: input.reason ?? null },
  });
}

export async function recordDeployCheckMemory(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    deployAnswer: DeployAnswer;
    productionConfidence: number | null;
    securityConfidence: number | null;
    stale: boolean;
    primaryBlockerPlain?: string | null;
    verdictId?: string | null;
    source: "mcp" | "web";
  }
): Promise<void> {
  await ensureProjectMemoryProfile(admin, input.organizationId, input.projectId);

  const minuteKey = new Date().toISOString().slice(0, 16);
  const idempotencyKey = `deploy_check:${input.source}:${minuteKey}`;

  await appendProtectionEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "deploy_readiness_checked",
    idempotencyKey,
    payload: {
      deployAnswer: input.deployAnswer,
      productionConfidence: input.productionConfidence,
      securityConfidence: input.securityConfidence,
      stale: input.stale,
    },
  });

  if (input.deployAnswer === "no_go") {
    await appendProtectionEvent(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      type: "deploy_blocked",
      idempotencyKey: `${idempotencyKey}:blocked`,
      payload: {
        primaryBlockerPlain: input.primaryBlockerPlain ?? null,
        productionConfidence: input.productionConfidence,
      },
    });

    const { data: profile } = await admin
      .from("project_memory_profile")
      .select("total_unsafe_prevented")
      .eq("project_id", input.projectId)
      .maybeSingle();

    await admin.from("project_memory_profile").upsert(
      {
        project_id: input.projectId,
        organization_id: input.organizationId,
        total_unsafe_prevented: (profile?.total_unsafe_prevented ?? 0) + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" }
    );
  } else if (input.deployAnswer === "go") {
    await appendProtectionEvent(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      type: "deploy_ready",
      idempotencyKey: `${idempotencyKey}:ready`,
      payload: {
        productionConfidence: input.productionConfidence,
        securityConfidence: input.securityConfidence,
      },
    });
  }

  await admin.from("protection_deployments").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    deploy_answer: input.deployAnswer,
    production_confidence: input.productionConfidence,
    security_confidence: input.securityConfidence,
    source: input.source,
    verdict_id: input.verdictId ?? null,
  });
}

export async function recordSafeFixMemory(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    recommendationId: string;
    titlePlain: string;
    severity: string;
    fingerprint?: string | null;
    verdictId?: string | null;
  }
): Promise<void> {
  await ensureProjectMemoryProfile(admin, input.organizationId, input.projectId);

  const recommendationId = randomUUID();
  const severity = ["critical", "high", "medium", "low", "info"].includes(input.severity)
    ? input.severity
    : "high";

  await admin.from("protection_recommendations").insert({
    id: recommendationId,
    organization_id: input.organizationId,
    project_id: input.projectId,
    finding_stable_id: input.recommendationId,
    title_plain: input.titlePlain,
    severity,
    status: "open",
    safe_fix_fingerprint: input.fingerprint ?? null,
    source_verdict_id: input.verdictId ?? null,
  });

  await appendProtectionEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "safe_fix_generated",
    idempotencyKey: `safe_fix:${input.recommendationId}:${input.titlePlain.slice(0, 40)}`,
    payload: {
      recommendationId,
      findingStableId: input.recommendationId,
      titlePlain: input.titlePlain,
      severity,
    },
  });
}
