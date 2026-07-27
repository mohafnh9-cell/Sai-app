import type { BusinessLogicTeamResult } from "../business-logic.types";
import type { BusinessLogicPersistArtifacts } from "./store.types";
import { buildBusinessLogicPlatformPayload } from "../integration/platform-payload";

export function serializeBusinessLogicArtifacts(
  result: BusinessLogicTeamResult
): BusinessLogicPersistArtifacts {
  const domain = result.context?.domainModel;
  const workflows = domain?.workflows ?? [];
  const fsms = domain?.stateMachines ?? [];
  const invariants = domain?.invariantCollection?.invariants ?? [];
  const abuseCases = domain?.abuseCollection?.cases ?? [];
  const specialistResults = domain?.specialistExecution?.results ?? [];
  const runtimeResults = domain?.runtimeExecution?.results ?? [];
  const findings = domain?.findingCollection?.findings ?? [];

  return {
    workflows: workflows.map((w) => ({
      workflowId: w.id,
      kind: w.kind,
      label: w.label,
      confidence: w.confidence,
      payload: w as unknown as Record<string, unknown>,
    })),
    stateMachines: fsms.map((m) => ({
      workflowId: m.workflowId,
      stateMachineId: m.id,
      payload: m as unknown as Record<string, unknown>,
    })),
    invariants: invariants.map((inv) => ({
      invariantId: inv.id,
      workflowId: inv.workflowId ?? null,
      payload: inv as unknown as Record<string, unknown>,
    })),
    abuseCases: abuseCases.map((c) => ({
      abuseCaseId: c.id,
      workflowId: c.targetWorkflowId ?? null,
      payload: c as unknown as Record<string, unknown>,
    })),
    specialistResults: specialistResults.map((s) => ({
      specialistId: s.specialistId,
      status: s.status,
      durationMs: s.durationMs,
      observationCount: s.observations.length,
      payload: s as unknown as Record<string, unknown>,
    })),
    runtimeResults: runtimeResults.map((r) => ({
      executionId: r.executionId,
      specialistId: r.specialistId,
      workflowId: r.workflowId,
      status: r.status,
      durationMs: r.durationMs,
      payload: r as unknown as Record<string, unknown>,
    })),
    findings: findings.map((f) => ({
      findingId: f.findingId,
      workflowId: f.workflowId,
      severity: f.severity,
      status: f.status,
      confidence: f.confidence,
      payload: f as unknown as Record<string, unknown>,
    })),
    replayPlans: findings.map((f) => ({
      replayPlanId: f.replayPlan.id,
      findingId: f.findingId,
      executable: f.replayPlan.executable,
      payload: f.replayPlan as unknown as Record<string, unknown>,
    })),
  };
}

export function buildRunHeaderFromResult(input: {
  result: BusinessLogicTeamResult;
  organizationId: string;
  projectId: string;
  redTeamRunId?: string | null;
  scanJobId?: string | null;
  idempotencyKey?: string | null;
  startedAtIso?: string;
  completedAtIso?: string;
  partial?: boolean;
  observabilityExtra?: Record<string, unknown>;
}): Omit<
  import("./store.types").BusinessLogicRunRecord,
  "createdAt" | "updatedAt"
> {
  const platform = buildBusinessLogicPlatformPayload(input.result);
  const specialist = input.result.context?.domainModel?.specialistExecution;
  const runtime = input.result.context?.domainModel?.runtimeExecution;

  return {
    id: input.result.businessLogicTeamRunId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    redTeamRunId: input.redTeamRunId ?? input.result.context?.redTeamRunId ?? null,
    scanJobId: input.scanJobId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    schemaVersion: 1,
    status: input.partial ? "partially_completed" : input.result.status,
    analysisPhase: input.result.analysisPhase,
    executionMode: input.result.executionMode,
    commitSha: input.result.context?.commitSha ?? null,
    workflowCount: input.result.workflowsDiscovered,
    fsmCount: input.result.context?.domainModel?.stateMachines.length ?? 0,
    invariantCount: input.result.invariantsExtracted,
    abuseCaseCount: input.result.abuseHypothesesGenerated,
    findingsCount: input.result.findingsCount,
    specialistsCompleted: input.result.specialistsCompleted,
    specialistsSkipped: specialist?.specialistsSkipped ?? 0,
    specialistsFailed: specialist?.specialistsFailed ?? 0,
    runtimeExecutionsCompleted: input.result.runtimeExecutionsCompleted,
    runtimeExecutionsFailed: runtime?.plansFailed ?? 0,
    coveragePercent: platform.coverage.coveragePercent,
    durationMs: input.result.durationMs,
    partialPersistence: Boolean(input.partial),
    observability: {
      ...platform.observability,
      ...(input.observabilityExtra ?? {}),
    },
    executionMetadata: {
      deferralReason: input.result.deferralReason ?? null,
      skippedReason: input.result.skippedReason ?? null,
      specialistSuccessRate: platform.observability.specialistSuccessRate,
      executionMode: input.result.executionMode,
    },
    startedAt: input.startedAtIso ?? null,
    completedAt: input.completedAtIso ?? new Date().toISOString(),
    metadata: {},
  };
}

/** Chunk large inserts for scalability (10k+ org workloads). */
export function chunkRows<T>(rows: T[], size = 250): T[][] {
  if (rows.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}
