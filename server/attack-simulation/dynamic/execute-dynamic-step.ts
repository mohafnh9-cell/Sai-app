import type { SafeRuntimeStepInput, SafeRuntimeStepResult } from "../runtime/types";
import {
  resolveAuthorizedDynamicTarget,
  resolveSandboxLabFixturesFromEnv,
  type DynamicTargetFixtures,
} from "./authorized-target";
import { createDynamicHttpClient } from "./http-client";
import { adapterSupportsDynamicExecution, executeDynamicAdapterProbe } from "./probes";

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
    return {
      outcome: "failed",
      classification: input.guard.mode === "sandbox" ? "sandbox" : "authorized_staging",
      expectedBehavior: "Dynamic probe completes within authorized scope",
      observedBehavior: error instanceof Error ? error.message : "Dynamic probe failed",
      statusCode: null,
      sideEffects: { dynamicError: true },
      auditTrail: [`dynamic:error:${input.adapterId}`],
      durationMs: 0,
      failureCode: "DYNAMIC_PROBE_FAILED",
      safeFailureMessage: error instanceof Error ? error.message : "Dynamic probe failed",
    };
  }
}
