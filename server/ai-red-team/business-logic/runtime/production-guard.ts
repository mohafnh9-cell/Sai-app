import type { BusinessLogicExecutionMode } from "./runtime.types";
import { BUSINESS_LOGIC_RUNTIME_PRODUCTION_FORBIDDEN } from "./runtime.config";

/** RT9 must never perform live production mutation. */
export function assertSafeBusinessLogicExecutionMode(mode: BusinessLogicExecutionMode): void {
  if (!BUSINESS_LOGIC_RUNTIME_PRODUCTION_FORBIDDEN) {
    throw new Error("BUSINESS_LOGIC_RUNTIME_PRODUCTION_FORBIDDEN must remain true.");
  }
  if (mode === "staging_candidate") {
    throw new Error("staging_candidate execution is disabled for RT9 production hardening.");
  }
}

export function isMockOnlyExecutionMode(mode: BusinessLogicExecutionMode): boolean {
  return mode === "mock_runtime" || mode === "simulation_only" || mode === "static_validation";
}
