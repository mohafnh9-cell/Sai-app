import type {
  AttackCampaign,
  AttackEvidence,
  AttackExecution,
  AttackExecutionPlan,
  AttackExecutionStep,
  AttackFinding,
  AttackMitigation,
  AttackReplay,
  AttackRuntimeEvent,
  AttackSafeFix,
  AttackScenario,
  ProtectionVerification,
} from "../contracts";

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asJsonArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** PostgREST may return timestamptz with a space separator or offset without colon. */
export function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string") {
    let trimmed = value.trim();
    if (!trimmed) return trimmed;

    if (/^\d{4}-\d{2}-\d{2} /.test(trimmed)) {
      trimmed = trimmed.replace(" ", "T");
    }

    trimmed = trimmed.replace(/([+-]\d{2})$/, "$1:00");

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

    return trimmed;
  }
  return String(value);
}

function normalizeTimestampNullable(value: unknown): string | null {
  if (value == null) return null;
  return normalizeTimestamp(value);
}

export function mapAttackCampaignRow(row: Record<string, unknown>): AttackCampaign {
  return {
    id: row.id as string,
    scanId: row.scan_id as string,
    scanJobId: (row.scan_job_id as string) ?? null,
    projectId: row.project_id as string,
    organizationId: row.organization_id as string,
    commitSha: row.commit_sha as string,
    runtimeMode: row.runtime_mode as AttackCampaign["runtimeMode"],
    status: row.status as AttackCampaign["status"],
    correlationId: row.correlation_id as string,
    authorizationId: (row.authorization_id as string) ?? null,
    startedAt: normalizeTimestampNullable(row.started_at),
    completedAt: normalizeTimestampNullable(row.completed_at),
    cancelledAt: normalizeTimestampNullable(row.cancelled_at),
    failureCode: (row.failure_code as string) ?? null,
    safeFailureMessage: (row.safe_failure_message as string) ?? null,
    totalScenarios: asNumber(row.total_scenarios),
    totalExecutions: asNumber(row.total_executions),
    completedExecutions: asNumber(row.completed_executions),
    confirmedFindings: asNumber(row.confirmed_findings),
    blockedExecutions: asNumber(row.blocked_executions),
    progressPercent: asNumber(row.progress_percent),
    estimatedRemainingMs:
      row.estimated_remaining_ms == null ? null : asNumber(row.estimated_remaining_ms),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapAttackScenarioRow(row: Record<string, unknown>): AttackScenario {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    hypothesisId: row.hypothesis_id as string,
    adapterId: row.adapter_id as string,
    category: row.category as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as AttackScenario["status"],
    sortOrder: asNumber(row.sort_order),
    redTeamSource: (row.red_team_source as string) ?? null,
    metadata: asJsonObject(row.metadata),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapAttackExecutionRow(row: Record<string, unknown>): AttackExecution {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    scenarioId: row.scenario_id as string,
    scanId: row.scan_id as string,
    scanJobId: (row.scan_job_id as string) ?? null,
    projectId: row.project_id as string,
    organizationId: row.organization_id as string,
    commitSha: row.commit_sha as string,
    runtimeMode: row.runtime_mode as AttackExecution["runtimeMode"],
    correlationId: row.correlation_id as string,
    attackerProfile: asJsonObject(row.attacker_profile),
    protectedAssets: asJsonArray(row.protected_assets),
    status: row.status as AttackExecution["status"],
    currentStage: row.current_stage as AttackExecution["currentStage"],
    currentStepId: (row.current_step_id as string) ?? null,
    currentStepTitle: (row.current_step_title as string) ?? null,
    elapsedMs: asNumber(row.elapsed_ms),
    progressPercent: asNumber(row.progress_percent),
    estimatedRemainingMs:
      row.estimated_remaining_ms == null ? null : asNumber(row.estimated_remaining_ms),
    startedAt: normalizeTimestampNullable(row.started_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    completedAt: normalizeTimestampNullable(row.completed_at),
    cancelledAt: normalizeTimestampNullable(row.cancelled_at),
    failureCode: (row.failure_code as string) ?? null,
    safeFailureMessage: (row.safe_failure_message as string) ?? null,
    createdAt: normalizeTimestamp(row.created_at),
  };
}

export function mapAttackExecutionStepRow(row: Record<string, unknown>): AttackExecutionStep {
  return {
    id: row.id as string,
    executionId: row.execution_id as string,
    campaignId: row.campaign_id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    sortOrder: asNumber(row.sort_order),
    kind: row.kind as string,
    label: row.label as string,
    weight: asNumber(row.weight),
    status: row.status as AttackExecutionStep["status"],
    startedAt: normalizeTimestampNullable(row.started_at),
    completedAt: normalizeTimestampNullable(row.completed_at),
    durationMs: row.duration_ms == null ? null : asNumber(row.duration_ms),
    failureCode: (row.failure_code as string) ?? null,
    metadata: asJsonObject(row.metadata),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapAttackExecutionPlanRow(row: Record<string, unknown>): AttackExecutionPlan {
  return {
    id: row.id as string,
    executionId: row.execution_id as string,
    campaignId: row.campaign_id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    version: asNumber(row.version, 1),
    stepIds: asStringArray(row.step_ids),
    totalWeight: asNumber(row.total_weight),
    planHash: row.plan_hash as string,
    metadata: asJsonObject(row.metadata),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

export function mapAttackEvidenceRow(row: Record<string, unknown>): AttackEvidence {
  return {
    id: row.id as string,
    executionId: row.execution_id as string,
    campaignId: row.campaign_id as string,
    scenarioId: row.scenario_id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    commitSha: row.commit_sha as string,
    environment: row.environment as AttackEvidence["environment"],
    expectedBehavior: row.expected_behavior as string,
    observedBehavior: row.observed_behavior as string,
    redactedRequest: asJsonObject(row.redacted_request),
    redactedResponse: asJsonObject(row.redacted_response),
    statusCode: row.status_code == null ? null : asNumber(row.status_code),
    sideEffects: asJsonObject(row.side_effects),
    preconditions: asJsonObject(row.preconditions),
    attackProfile: asJsonObject(row.attack_profile),
    protectedAssets: asJsonArray(row.protected_assets),
    reproducibility: row.reproducibility as string,
    confidence: asNumber(row.confidence),
    replayInstructions: row.replay_instructions as string,
    capturedAt: normalizeTimestamp(row.captured_at),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

export function mapAttackFindingRow(row: Record<string, unknown>): AttackFinding {
  return {
    id: row.id as string,
    executionId: row.execution_id as string,
    campaignId: row.campaign_id as string,
    scenarioId: row.scenario_id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    evidenceId: (row.evidence_id as string) ?? null,
    title: row.title as string,
    description: row.description as string,
    category: row.category as string,
    severity: row.severity as AttackFinding["severity"],
    confidence: asNumber(row.confidence),
    outcome: row.outcome as AttackFinding["outcome"],
    impact: row.impact as string,
    rootCause: (row.root_cause as string) ?? null,
    metadata: asJsonObject(row.metadata),
    confirmedAt: normalizeTimestampNullable(row.confirmed_at),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapAttackMitigationRow(row: Record<string, unknown>): AttackMitigation {
  return {
    id: row.id as string,
    findingId: row.finding_id as string,
    executionId: row.execution_id as string,
    campaignId: row.campaign_id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    plainLanguageExplanation: row.plain_language_explanation as string,
    rootCause: row.root_cause as string,
    recommendedProtection: row.recommended_protection as string,
    likelyAffectedFiles: asStringArray(row.likely_affected_files),
    implementationSteps: asStringArray(row.implementation_steps),
    implementationRisk: row.implementation_risk as AttackMitigation["implementationRisk"],
    safeFixConfidence: asNumber(row.safe_fix_confidence),
    estimatedLoc: row.estimated_loc == null ? null : asNumber(row.estimated_loc),
    rollbackGuidance: row.rollback_guidance as string,
    residualRisk: row.residual_risk as string,
    metadata: asJsonObject(row.metadata),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapAttackSafeFixRow(row: Record<string, unknown>): AttackSafeFix {
  return {
    id: row.id as string,
    mitigationId: row.mitigation_id as string,
    findingId: row.finding_id as string,
    executionId: row.execution_id as string,
    campaignId: row.campaign_id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    safeFixRecordId: (row.safe_fix_record_id as string) ?? null,
    status: row.status as AttackSafeFix["status"],
    cursorPrompt: row.cursor_prompt as string,
    patchProposal: row.patch_proposal ? asJsonObject(row.patch_proposal) : null,
    pullRequestProposal: row.pull_request_proposal
      ? asJsonObject(row.pull_request_proposal)
      : null,
    requiredTests: asStringArray(row.required_tests),
    rollbackPlan: row.rollback_plan as string,
    affectedFiles: asStringArray(row.affected_files),
    confidence: asNumber(row.confidence),
    implementationRisk: row.implementation_risk as AttackSafeFix["implementationRisk"],
    estimatedLoc: row.estimated_loc == null ? null : asNumber(row.estimated_loc),
    metadata: asJsonObject(row.metadata),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export function mapAttackReplayRow(row: Record<string, unknown>): AttackReplay {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    originalExecutionId: row.original_execution_id as string,
    replayExecutionId: row.replay_execution_id as string,
    findingId: (row.finding_id as string) ?? null,
    safeFixId: (row.safe_fix_id as string) ?? null,
    startedAt: normalizeTimestampNullable(row.started_at),
    completedAt: normalizeTimestampNullable(row.completed_at),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

export function mapProtectionVerificationRow(row: Record<string, unknown>): ProtectionVerification {
  return {
    id: row.id as string,
    replayId: row.replay_id as string,
    campaignId: row.campaign_id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    originalExecutionId: row.original_execution_id as string,
    replayExecutionId: row.replay_execution_id as string,
    findingId: (row.finding_id as string) ?? null,
    outcome: row.outcome as ProtectionVerification["outcome"],
    originalEvidenceId: (row.original_evidence_id as string) ?? null,
    replayEvidenceId: (row.replay_evidence_id as string) ?? null,
    comparison: asJsonObject(row.comparison),
    verifiedAt: normalizeTimestampNullable(row.verified_at),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

export function mapAttackRuntimeEventRow(row: Record<string, unknown>): AttackRuntimeEvent {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    executionId: (row.execution_id as string) ?? null,
    stepId: (row.step_id as string) ?? null,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    correlationId: row.correlation_id as string,
    eventType: row.event_type as AttackRuntimeEvent["eventType"],
    payload: asJsonObject(row.payload),
    occurredAt: normalizeTimestamp(row.occurred_at),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

export function toAttackCampaignInsertRow(input: {
  scanId: string;
  scanJobId: string | null;
  projectId: string;
  organizationId: string;
  commitSha: string;
  runtimeMode: AttackCampaign["runtimeMode"];
  authorizationId?: string | null;
  correlationId?: string;
}) {
  return {
    scan_id: input.scanId,
    scan_job_id: input.scanJobId,
    project_id: input.projectId,
    organization_id: input.organizationId,
    commit_sha: input.commitSha,
    runtime_mode: input.runtimeMode,
    authorization_id: input.authorizationId ?? null,
    correlation_id: input.correlationId,
    status: "planned",
    progress_percent: 0,
    estimated_remaining_ms: null,
  };
}
