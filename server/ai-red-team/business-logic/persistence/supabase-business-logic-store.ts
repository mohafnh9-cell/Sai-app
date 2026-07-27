import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BusinessLogicPersistArtifacts,
  BusinessLogicRunRecord,
  BusinessLogicRunStore,
  PersistBusinessLogicRunOutcome,
} from "./store.types";
import { chunkRows } from "./serialize-run-artifacts";

function mapRunRow(row: Record<string, unknown>): BusinessLogicRunRecord {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    redTeamRunId: (row.red_team_run_id as string | null) ?? null,
    scanJobId: (row.scan_job_id as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    schemaVersion: row.schema_version as number,
    status: row.status as string,
    analysisPhase: row.analysis_phase as string,
    executionMode: row.execution_mode as string,
    commitSha: (row.commit_sha as string | null) ?? null,
    workflowCount: row.workflow_count as number,
    fsmCount: row.fsm_count as number,
    invariantCount: row.invariant_count as number,
    abuseCaseCount: row.abuse_case_count as number,
    findingsCount: row.findings_count as number,
    specialistsCompleted: row.specialists_completed as number,
    specialistsSkipped: row.specialists_skipped as number,
    specialistsFailed: row.specialists_failed as number,
    runtimeExecutionsCompleted: row.runtime_executions_completed as number,
    runtimeExecutionsFailed: row.runtime_executions_failed as number,
    coveragePercent: row.coverage_percent != null ? Number(row.coverage_percent) : null,
    durationMs: row.duration_ms as number,
    partialPersistence: Boolean(row.partial_persistence),
    observability: (row.observability as Record<string, unknown>) ?? {},
    executionMetadata: (row.execution_metadata as Record<string, unknown>) ?? {},
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function headerToRow(header: Omit<BusinessLogicRunRecord, "createdAt" | "updatedAt">, now: string) {
  return {
    id: header.id,
    organization_id: header.organizationId,
    project_id: header.projectId,
    red_team_run_id: header.redTeamRunId,
    scan_job_id: header.scanJobId,
    idempotency_key: header.idempotencyKey,
    schema_version: header.schemaVersion,
    status: header.status,
    analysis_phase: header.analysisPhase,
    execution_mode: header.executionMode,
    commit_sha: header.commitSha,
    workflow_count: header.workflowCount,
    fsm_count: header.fsmCount,
    invariant_count: header.invariantCount,
    abuse_case_count: header.abuseCaseCount,
    findings_count: header.findingsCount,
    specialists_completed: header.specialistsCompleted,
    specialists_skipped: header.specialistsSkipped,
    specialists_failed: header.specialistsFailed,
    runtime_executions_completed: header.runtimeExecutionsCompleted,
    runtime_executions_failed: header.runtimeExecutionsFailed,
    coverage_percent: header.coveragePercent,
    duration_ms: header.durationMs,
    partial_persistence: header.partialPersistence,
    observability: header.observability,
    execution_metadata: header.executionMetadata,
    started_at: header.startedAt,
    completed_at: header.completedAt,
    metadata: header.metadata,
    updated_at: now,
  };
}

async function replaceChildRows(
  admin: SupabaseClient,
  runId: string,
  artifacts: BusinessLogicPersistArtifacts,
  orgId: string,
  projectId: string
): Promise<void> {
  const tables = [
    "business_logic_workflows",
    "business_logic_state_machines",
    "business_logic_invariants",
    "business_logic_abuse_cases",
    "business_logic_specialist_results",
    "business_logic_runtime_results",
    "business_logic_findings",
    "business_logic_replay_plans",
  ] as const;

  for (const table of tables) {
    const { error } = await admin.from(table).delete().eq("business_logic_run_id", runId);
    if (error) throw new Error(`${table} delete failed: ${error.message}`);
  }

  const workflowRows = artifacts.workflows.map((w) => ({
    organization_id: orgId,
    project_id: projectId,
    business_logic_run_id: runId,
    workflow_id: w.workflowId,
    kind: w.kind,
    label: w.label,
    confidence: w.confidence,
    payload: w.payload,
  }));

  const fsmRows = artifacts.stateMachines.map((m) => ({
    organization_id: orgId,
    project_id: projectId,
    business_logic_run_id: runId,
    workflow_id: m.workflowId,
    state_machine_id: m.stateMachineId,
    payload: m.payload,
  }));

  const invariantRows = artifacts.invariants.map((inv) => ({
    organization_id: orgId,
    project_id: projectId,
    business_logic_run_id: runId,
    invariant_id: inv.invariantId,
    workflow_id: inv.workflowId,
    payload: inv.payload,
  }));

  const abuseRows = artifacts.abuseCases.map((c) => ({
    organization_id: orgId,
    project_id: projectId,
    business_logic_run_id: runId,
    abuse_case_id: c.abuseCaseId,
    workflow_id: c.workflowId,
    payload: c.payload,
  }));

  const specialistRows = artifacts.specialistResults.map((s) => ({
    organization_id: orgId,
    project_id: projectId,
    business_logic_run_id: runId,
    specialist_id: s.specialistId,
    status: s.status,
    duration_ms: s.durationMs,
    observation_count: s.observationCount,
    payload: s.payload,
  }));

  const runtimeRows = artifacts.runtimeResults.map((r) => ({
    organization_id: orgId,
    project_id: projectId,
    business_logic_run_id: runId,
    execution_id: r.executionId,
    specialist_id: r.specialistId,
    workflow_id: r.workflowId,
    status: r.status,
    duration_ms: r.durationMs,
    payload: r.payload,
  }));

  const findingRows = artifacts.findings.map((f) => ({
    organization_id: orgId,
    project_id: projectId,
    business_logic_run_id: runId,
    finding_id: f.findingId,
    workflow_id: f.workflowId,
    severity: f.severity,
    status: f.status,
    confidence: f.confidence,
    payload: f.payload,
  }));

  const replayRows = artifacts.replayPlans.map((p) => ({
    organization_id: orgId,
    project_id: projectId,
    business_logic_run_id: runId,
    replay_plan_id: p.replayPlanId,
    finding_id: p.findingId,
    executable: p.executable,
    payload: p.payload,
  }));

  const inserts: Array<{ table: string; rows: Record<string, unknown>[] }> = [
    { table: "business_logic_workflows", rows: workflowRows },
    { table: "business_logic_state_machines", rows: fsmRows },
    { table: "business_logic_invariants", rows: invariantRows },
    { table: "business_logic_abuse_cases", rows: abuseRows },
    { table: "business_logic_specialist_results", rows: specialistRows },
    { table: "business_logic_runtime_results", rows: runtimeRows },
    { table: "business_logic_findings", rows: findingRows },
    { table: "business_logic_replay_plans", rows: replayRows },
  ];

  for (const { table, rows } of inserts) {
    for (const batch of chunkRows(rows)) {
      if (batch.length === 0) continue;
      const { error } = await admin.from(table).insert(batch);
      if (error) throw new Error(`${table} insert failed: ${error.message}`);
    }
  }
}

export function createSupabaseBusinessLogicRunStore(admin: SupabaseClient): BusinessLogicRunStore {
  return {
    async findByIdempotency(projectId, idempotencyKey) {
      const { data } = await admin
        .from("business_logic_runs")
        .select("*")
        .eq("project_id", projectId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      return data ? mapRunRow(data as Record<string, unknown>) : null;
    },

    async getRun(runId) {
      const { data } = await admin
        .from("business_logic_runs")
        .select("*")
        .eq("id", runId)
        .maybeSingle();
      return data ? mapRunRow(data as Record<string, unknown>) : null;
    },

    async persistRun(input) {
      const now = new Date().toISOString();

      const { count: revisionCount } = await admin
        .from("business_logic_run_revisions")
        .select("id", { count: "exact", head: true })
        .eq("business_logic_run_id", input.header.id);

      const revision = (revisionCount ?? 0) + 1;

      const row = {
        ...headerToRow(input.header, now),
        metadata: { ...input.header.metadata, revision },
        created_at: now,
      };

      const { error: upsertError } = await admin.from("business_logic_runs").upsert(row, {
        onConflict: "id",
      });
      if (upsertError) throw new Error(`business_logic_runs upsert failed: ${upsertError.message}`);

      await replaceChildRows(
        admin,
        input.header.id,
        input.artifacts,
        input.header.organizationId,
        input.header.projectId
      );

      const { error: revError } = await admin.from("business_logic_run_revisions").upsert(
        {
          business_logic_run_id: input.header.id,
          organization_id: input.header.organizationId,
          project_id: input.header.projectId,
          revision,
          reason: input.revisionReason ?? "run_complete",
          snapshot: {
            counts: {
              workflows: input.artifacts.workflows.length,
              findings: input.artifacts.findings.length,
            },
          },
        },
        { onConflict: "business_logic_run_id,revision" }
      );
      if (revError) throw new Error(`business_logic_run_revisions upsert failed: ${revError.message}`);

      const outcome: PersistBusinessLogicRunOutcome = {
        runId: input.header.id,
        revision,
        persisted: true,
        partialPersistence: input.header.partialPersistence,
        counts: {
          workflows: input.artifacts.workflows.length,
          fsms: input.artifacts.stateMachines.length,
          invariants: input.artifacts.invariants.length,
          abuseCases: input.artifacts.abuseCases.length,
          specialists: input.artifacts.specialistResults.length,
          runtimeResults: input.artifacts.runtimeResults.length,
          findings: input.artifacts.findings.length,
          replayPlans: input.artifacts.replayPlans.length,
        },
      };
      return outcome;
    },
  };
}
