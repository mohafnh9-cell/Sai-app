import type { SafeRuntimeStepInput, SafeRuntimeStepResult } from "../runtime/types";
import {
  resolveAuthorizedDynamicTarget,
  resolveSandboxLabFixturesFromEnv,
  type DynamicTargetFixtures,
} from "./authorized-target";
import { createDynamicHttpClient } from "./http-client";
import { adapterSupportsDynamicExecution, executeDynamicAdapterProbe } from "./probes";

function mapDynamicError(error: unknown): Pick<
  SafeRuntimeStepResult,
  "failureCode" | "safeFailureMessage" | "observedBehavior"
> {
  const message = error instanceof Error ? error.message : "Dynamic probe failed";
  const lower = message.toLowerCase();

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return { failureCode: "TIMEOUT", safeFailureMessage: message, observedBehavior: message };
  }
  if (lower.includes("redirect blocked") || lower.includes("outside authorized scope") || lower.includes("excluded")) {
    return { failureCode: "BLOCKED_SCOPE", safeFailureMessage: message, observedBehavior: message };
  }
  if (lower.includes("not approved") || lower.includes("expired") || lower.includes("origin mismatch")) {
    return { failureCode: "NOT_AUTHORIZED", safeFailureMessage: message, observedBehavior: message };
  }
  if (lower.includes("budget exceeded")) {
    return { failureCode: "BUDGET_EXCEEDED", safeFailureMessage: message, observedBehavior: message };
  }
  if (lower.includes("cancelled")) {
    return { failureCode: "CANCELLED", safeFailureMessage: message, observedBehavior: message };
  }
  if (lower.includes("fetch failed") || lower.includes("network") || lower.includes("econnrefused")) {
    return { failureCode: "NETWORK_ERROR", safeFailureMessage: message, observedBehavior: message };
  }
  if (lower.includes("unavailable") || lower.includes("enotfound")) {
    return { failureCode: "TARGET_UNAVAILABLE", safeFailureMessage: message, observedBehavior: message };
  }

  return { failureCode: "DYNAMIC_PROBE_FAILED", safeFailureMessage: message, observedBehavior: message };
}

export async function tryExecuteDynamicHttpStep(
  input: SafeRuntimeStepInput
): Promise<SafeRuntimeStepResult | null> {
  if (input.stepKind !== "execute_request") return null;
  if (!input.adapterId || !adapterSupportsDynamicExecution(input.adapterId)) return null;

  const target = resolveAuthorizedDynamicTarget({
    guard: input.guard,
    fixtures: input.fixtures as DynamicTargetFixtures | undefined,
  });
  if (!target) return null;

  const client = createDynamicHttpClient({
    target,
    correlationId: input.guard.tenant.correlationId,
    concurrencyLimiter: input.guard.httpConcurrencyLimiter,
    isCancelled: () => Boolean(input.guard.cancelled || input.guard.emergencyStop),
    onRequestConsumed: () => {
      input.guard.requestsConsumed += 1;
    },
  });

  const envFixtures = resolveSandboxLabFixturesFromEnv();
  const scenarioFixtures = input.fixtures as DynamicTargetFixtures | undefined;
  const fixtures: DynamicTargetFixtures | undefined =
    envFixtures || scenarioFixtures
      ? {
          ...envFixtures,
          ...scenarioFixtures,
          paths: {
            ...envFixtures?.paths,
            ...scenarioFixtures?.paths,
          },
        }
      : undefined;

  try {
    const result = await executeDynamicAdapterProbe({
      adapterId: input.adapterId,
      target,
      client,
      fixtures,
      correlationId: input.guard.tenant.correlationId,
    });
    if (!result) return null;
    return {
      ...result,
      sideEffects: {
        ...(result.sideEffects ?? {}),
        httpRequestsSent: client.requestsSent,
        targetHostname: new URL(target.origin).hostname,
      },
    };
  } catch (error) {
    const mapped = mapDynamicError(error);
    return {
      outcome: "failed",
      classification: input.guard.mode === "sandbox" ? "sandbox" : "authorized_staging",
      expectedBehavior: "Dynamic probe completes within authorized scope",
      observedBehavior: mapped.observedBehavior,
      statusCode: null,
      sideEffects: { dynamicError: true },
      auditTrail: [`dynamic:error:${input.adapterId}`],
      durationMs: 0,
      failureCode: mapped.failureCode,
      safeFailureMessage: mapped.safeFailureMessage,
    };
  }
}
