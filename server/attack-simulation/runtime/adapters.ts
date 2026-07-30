import type { AttackRuntimeMode } from "../contracts/enums";
import type {
  SafeRuntimeAdapter,
  SafeRuntimeCleanupInput,
  SafeRuntimeStepInput,
  SafeRuntimeStepResult,
} from "./types";
import { enforceSafeRuntimeGuards } from "./guards";

function blockedResult(input: SafeRuntimeStepInput, code: string, message: string): SafeRuntimeStepResult {
  return {
    outcome: "blocked",
    classification: "blocked",
    observedBehavior: message,
    expectedBehavior: `Safe completion of ${input.stepLabel}`,
    auditTrail: [`blocked:${code}`],
    durationMs: 0,
    failureCode: code,
    safeFailureMessage: message,
  };
}

function guardOrProceed(input: SafeRuntimeStepInput): SafeRuntimeStepResult | null {
  const guard = enforceSafeRuntimeGuards(input.guard);
  if (!guard.ok) {
    return blockedResult(input, guard.violation.code, guard.violation.message);
  }
  return null;
}

function simulatedStep(input: SafeRuntimeStepInput, classification: SafeRuntimeStepResult["classification"]): SafeRuntimeStepResult {
  return {
    outcome: "completed",
    classification,
    expectedBehavior: `Safe completion of ${input.stepLabel}`,
    observedBehavior: `${input.stepLabel} simulated without network I/O`,
    statusCode: null,
    sideEffects: {},
    auditTrail: [`simulated:${input.stepKind}`, `mode:${input.guard.mode}`],
    durationMs: 1,
  };
}

export const staticRuntimeAdapter: SafeRuntimeAdapter = {
  mode: "static",
  async executeStep(input) {
    const blocked = guardOrProceed(input);
    if (blocked) return blocked;
    return simulatedStep(input, "static_analysis");
  },
};

export const mockRuntimeAdapter: SafeRuntimeAdapter = {
  mode: "mock",
  async executeStep(input) {
    const blocked = guardOrProceed(input);
    if (blocked) return blocked;
    return simulatedStep(input, "simulated");
  },
};

export const sandboxRuntimeAdapter: SafeRuntimeAdapter = {
  mode: "sandbox",
  async executeStep(input) {
    const blocked = guardOrProceed(input);
    if (blocked) return blocked;
    if (input.stepKind === "execute_request" && input.guard.network.url) {
      return {
        outcome: "completed",
        classification: "sandbox",
        expectedBehavior: "Sandbox request stays within allowlisted hosts",
        observedBehavior: `Sandbox fixture response for ${input.guard.network.url}`,
        statusCode: 200,
        sideEffects: { sandbox: true },
        auditTrail: ["sandbox:fixture_response"],
        durationMs: 2,
      };
    }
    return simulatedStep(input, "sandbox");
  },
};

export const authorizedStagingRuntimeAdapter: SafeRuntimeAdapter = {
  mode: "authorized_staging",
  async executeStep(input) {
    const blocked = guardOrProceed(input);
    if (blocked) return blocked;
    return {
      outcome: "completed",
      classification: "authorized_staging",
      expectedBehavior: "Authorized staging step completes within approved scope",
      observedBehavior: `${input.stepLabel} executed against authorized staging target`,
      statusCode: input.stepKind === "execute_request" ? 200 : null,
      sideEffects: { authorizedStaging: true },
      auditTrail: ["authorized_staging:simulated_step"],
      durationMs: 3,
    };
  },
};

export const blockedRuntimeAdapter: SafeRuntimeAdapter = {
  mode: "blocked",
  async executeStep(input) {
    return blockedResult(input, "RUNTIME_MODE_BLOCKED", "Runtime mode blocked");
  },
};

export const unsupportedRuntimeAdapter: SafeRuntimeAdapter = {
  mode: "unsupported",
  async executeStep(input) {
    return blockedResult(input, "RUNTIME_UNSUPPORTED", "Runtime mode unsupported");
  },
};

export const SAFE_RUNTIME_ADAPTERS: readonly SafeRuntimeAdapter[] = [
  staticRuntimeAdapter,
  mockRuntimeAdapter,
  sandboxRuntimeAdapter,
  authorizedStagingRuntimeAdapter,
  blockedRuntimeAdapter,
  unsupportedRuntimeAdapter,
];

export function resolveSafeRuntimeAdapter(mode: AttackRuntimeMode): SafeRuntimeAdapter {
  return SAFE_RUNTIME_ADAPTERS.find((adapter) => adapter.mode === mode) ?? unsupportedRuntimeAdapter;
}

export async function runSafeRuntimeCleanup(
  adapter: SafeRuntimeAdapter,
  input: SafeRuntimeCleanupInput
): Promise<void> {
  if (adapter.cleanup) {
    await adapter.cleanup(input);
  }
}
