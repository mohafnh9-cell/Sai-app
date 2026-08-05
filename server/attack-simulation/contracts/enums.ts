/** Canonical enums — English constants only; UI translates labels. */

export const ATTACK_RUNTIME_MODES = [
  "static",
  "mock",
  "sandbox",
  "authorized_staging",
  "blocked",
  "unsupported",
] as const;
export type AttackRuntimeMode = (typeof ATTACK_RUNTIME_MODES)[number];

export const ATTACK_CAMPAIGN_STATUSES = [
  "planned",
  "queued",
  "preparing",
  "running",
  "paused",
  "completing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AttackCampaignStatus = (typeof ATTACK_CAMPAIGN_STATUSES)[number];

export const ATTACK_SCENARIO_STATUSES = [
  "planned",
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type AttackScenarioStatus = (typeof ATTACK_SCENARIO_STATUSES)[number];

export const ATTACK_EXECUTION_STATUSES = [
  "planned",
  "queued",
  "preparing",
  "validating_preconditions",
  "creating_fixtures",
  "executing",
  "observing",
  "collecting_evidence",
  "evaluating",
  "confirmed",
  "not_exploitable",
  "blocked",
  "generating_mitigation",
  "fix_ready",
  "applying_fix",
  "replaying",
  "protected",
  "still_vulnerable",
  "cleaning_up",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AttackExecutionStatus = (typeof ATTACK_EXECUTION_STATUSES)[number];

export const ATTACK_EXECUTION_STEP_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type AttackExecutionStepStatus = (typeof ATTACK_EXECUTION_STEP_STATUSES)[number];

export const ATTACK_FINDING_OUTCOMES = [
  "pending",
  "confirmed",
  "not_exploitable",
  "inconclusive",
] as const;
export type AttackFindingOutcome = (typeof ATTACK_FINDING_OUTCOMES)[number];

export const ATTACK_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type AttackSeverity = (typeof ATTACK_SEVERITIES)[number];

export const PROTECTION_VERIFICATION_OUTCOMES = [
  "protected",
  "still_vulnerable",
  "inconclusive",
] as const;
export type ProtectionVerificationOutcome = (typeof PROTECTION_VERIFICATION_OUTCOMES)[number];

export const ATTACK_SAFE_FIX_STATUSES = [
  "draft",
  "ready",
  "applied",
  "verified",
  "failed",
  "superseded",
] as const;
export type AttackSafeFixStatus = (typeof ATTACK_SAFE_FIX_STATUSES)[number];

export const ATTACK_RUNTIME_EVENT_TYPES = [
  "attack_campaign_started",
  "attack_planned",
  "attack_preconditions_validated",
  "attack_execution_started",
  "attack_step_started",
  "attack_step_completed",
  "attack_evidence_collected",
  "attack_confirmed",
  "attack_not_exploitable",
  "attack_blocked",
  "mitigation_generation_started",
  "safe_fix_ready",
  "safe_fix_applied",
  "attack_replay_started",
  "protection_verified",
  "attack_still_vulnerable",
  "attack_cleanup_completed",
  "attack_failed",
  "attack_cancelled",
] as const;
export type AttackRuntimeEventType = (typeof ATTACK_RUNTIME_EVENT_TYPES)[number];

export const TERMINAL_ATTACK_CAMPAIGN_STATUSES: ReadonlySet<AttackCampaignStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export const TERMINAL_ATTACK_EXECUTION_STATUSES: ReadonlySet<AttackExecutionStatus> = new Set([
  "confirmed",
  "not_exploitable",
  "blocked",
  "protected",
  "still_vulnerable",
  "fix_ready",
  "completed",
  "failed",
  "cancelled",
]);
