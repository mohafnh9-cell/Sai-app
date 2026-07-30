import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import type { AttackRuntimeMode } from "../contracts/enums";

export type SafeRuntimeTenantContext = {
  organizationId: string;
  projectId: string;
  campaignId: string;
  executionId: string;
  correlationId: string;
};

export type SafeRuntimeNetworkIntent = {
  url?: string | null;
  method?: string;
  kind: "none" | "http" | "browser" | "fixture";
};

export type SafeRuntimeGuardLimits = {
  maxRequestBudget: number;
  maxDurationMs: number;
  maxConcurrentRequests?: number;
};

export type SafeRuntimeGuardContext = {
  mode: AttackRuntimeMode;
  tenant: SafeRuntimeTenantContext;
  commitSha: string;
  authorization?: AttackAuthorizationRecord | null;
  limits: SafeRuntimeGuardLimits;
  network: SafeRuntimeNetworkIntent;
  requestsConsumed: number;
  startedAtMs: number;
  nowMs?: number;
  cancelled?: boolean;
  emergencyStop?: boolean;
};

export type SafeRuntimeGuardViolation = {
  code: string;
  message: string;
};

export type SafeRuntimeGuardResult =
  | { ok: true }
  | { ok: false; violation: SafeRuntimeGuardViolation };

export type SafeRuntimeStepKind =
  | "validate_preconditions"
  | "create_fixtures"
  | "authenticate_attacker"
  | "execute_request"
  | "observe_response"
  | "verify_side_effects"
  | "collect_evidence"
  | "cleanup";

export type SafeRuntimeStepInput = {
  guard: SafeRuntimeGuardContext;
  stepKind: SafeRuntimeStepKind;
  stepLabel: string;
  fixtures?: Record<string, unknown>;
  attackerProfile?: Record<string, unknown>;
  adapterId?: string;
  protectedAssets?: Record<string, unknown>[];
};

export type SafeRuntimeStepOutcome =
  | "completed"
  | "blocked"
  | "skipped"
  | "failed"
  | "timeout"
  | "budget_exceeded"
  | "cancelled";

export type SafeRuntimeStepResult = {
  outcome: SafeRuntimeStepOutcome;
  classification: "simulated" | "static_analysis" | "sandbox" | "authorized_staging" | "blocked";
  observedBehavior: string;
  expectedBehavior?: string;
  statusCode?: number | null;
  sideEffects?: Record<string, unknown>;
  auditTrail: string[];
  durationMs: number;
  failureCode?: string;
  safeFailureMessage?: string;
};

export type SafeRuntimeCleanupInput = {
  guard: SafeRuntimeGuardContext;
  reason: "completed" | "cancelled" | "failed" | "emergency_stop";
};

export interface SafeRuntimeAdapter {
  readonly mode: AttackRuntimeMode;
  executeStep(input: SafeRuntimeStepInput): Promise<SafeRuntimeStepResult>;
  cleanup?(input: SafeRuntimeCleanupInput): Promise<void>;
}

export class SafeRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "SafeRuntimeError";
  }
}
