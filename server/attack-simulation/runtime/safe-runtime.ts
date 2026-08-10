import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import type { AttackRuntimeMode } from "../contracts/enums";
import { createDynamicHttpConcurrencyLimiter } from "../dynamic/concurrency-limiter";
import { adapterSupportsDynamicExecution } from "../dynamic/probes";
import { isDynamicRuntimeMode } from "../dynamic/authorized-target";
import { resolveSafeRuntimeAdapter, runSafeRuntimeCleanup } from "./adapters";
import {
  authorizationBudgetLimits,
  enforceSafeRuntimeGuards,
  networkIntentFromTarget,
} from "./guards";
import type {
  SafeRuntimeGuardContext,
  SafeRuntimeStepInput,
  SafeRuntimeStepResult,
  SafeRuntimeTenantContext,
} from "./types";

export type SafeRuntimeSession = {
  guard: SafeRuntimeGuardContext;
  adapter: ReturnType<typeof resolveSafeRuntimeAdapter>;
};

export type CreateSafeRuntimeSessionInput = {
  mode: AttackRuntimeMode;
  tenant: SafeRuntimeTenantContext;
  commitSha: string;
  authorization?: AttackAuthorizationRecord | null;
  targetUrl?: string | null;
  startedAtMs?: number;
};

export function createSafeRuntimeSession(input: CreateSafeRuntimeSessionInput): SafeRuntimeSession {
  const adapter = resolveSafeRuntimeAdapter(input.mode);
  const limits = authorizationBudgetLimits(input.authorization);
  const guard: SafeRuntimeGuardContext = {
    mode: input.mode,
    tenant: input.tenant,
    commitSha: input.commitSha,
    authorization: input.authorization ?? null,
    limits,
    network: networkIntentFromTarget(input.mode, input.targetUrl ?? null),
    requestsConsumed: 0,
    startedAtMs: input.startedAtMs ?? Date.now(),
    cancelled: false,
    emergencyStop: false,
    httpConcurrencyLimiter: createDynamicHttpConcurrencyLimiter(
      limits.maxConcurrentRequests ?? 3
    ),
  };

  return { guard, adapter };
}

export function markSafeRuntimeCancelled(session: SafeRuntimeSession): SafeRuntimeSession {
  return {
    ...session,
    guard: { ...session.guard, cancelled: true },
  };
}

export function markSafeRuntimeEmergencyStop(session: SafeRuntimeSession): SafeRuntimeSession {
  return {
    ...session,
    guard: { ...session.guard, emergencyStop: true },
  };
}

export function consumeSafeRuntimeRequestBudget(session: SafeRuntimeSession): SafeRuntimeSession {
  return {
    ...session,
    guard: {
      ...session.guard,
      requestsConsumed: session.guard.requestsConsumed + 1,
    },
  };
}

export async function executeSafeRuntimeStep(
  session: SafeRuntimeSession,
  input: Omit<SafeRuntimeStepInput, "guard">
): Promise<{ session: SafeRuntimeSession; result: SafeRuntimeStepResult }> {
  const preflight = enforceSafeRuntimeGuards(session.guard);
  if (!preflight.ok) {
    return {
      session,
      result: {
        outcome: "blocked",
        classification: "blocked",
        observedBehavior: preflight.violation.message,
        auditTrail: [`preflight:${preflight.violation.code}`],
        durationMs: 0,
        failureCode: preflight.violation.code,
        safeFailureMessage: preflight.violation.message,
      },
    };
  }

  const isDynamicHttpStep =
    input.stepKind === "execute_request" &&
    Boolean(input.adapterId) &&
    adapterSupportsDynamicExecution(input.adapterId!) &&
    isDynamicRuntimeMode(session.guard.mode);

  const withBudget = isDynamicHttpStep ? session : consumeSafeRuntimeRequestBudget(session);
  const result = await withBudget.adapter.executeStep({
    ...input,
    guard: withBudget.guard,
  });

  return { session: withBudget, result };
}

export async function cleanupSafeRuntimeSession(
  session: SafeRuntimeSession,
  reason: "completed" | "cancelled" | "failed" | "emergency_stop"
): Promise<void> {
  await runSafeRuntimeCleanup(session.adapter, { guard: session.guard, reason });
}

export function assertSafeRuntimeReady(session: SafeRuntimeSession) {
  const result = enforceSafeRuntimeGuards(session.guard);
  if (!result.ok) {
    return result;
  }
  return { ok: true as const };
}
