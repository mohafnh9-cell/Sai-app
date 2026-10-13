/**
 * Dynamic security testing (real HTTP against an application) is NOT part of SequrAI V1.
 *
 * The execution controls it needs are not complete (see docs/RED_TEAM_AUDIT_2026-10-13.md: no credential resolution, no
 * request-time address check, no response-size cap, no in-flight cancellation, no operator kill switch). Until they exist the
 * capability is closed in the SERVER, for every entry point (API, MCP, scan pipeline, executor), not by hiding a button.
 *
 * It opens only when an operator sets SEQURAI_DYNAMIC_SECURITY_TESTING_ENABLED=true (tests and the local lab do). Opening it
 * does not remove the existing authorization, scope, budget or production gates: those still apply.
 */
export const DYNAMIC_TESTING_ENV = "SEQURAI_DYNAMIC_SECURITY_TESTING_ENABLED";

export const DYNAMIC_TESTING_UNAVAILABLE_CODE = "DYNAMIC_TESTING_UNAVAILABLE";

export const DYNAMIC_TESTING_UNAVAILABLE_MESSAGE =
  "Dynamic security testing is not available yet. SequrAI V1 analyzes the repository; it does not run attacks against a deployed application.";

export function isDynamicSecurityTestingAvailable(): boolean {
  return process.env[DYNAMIC_TESTING_ENV]?.trim() === "true";
}

const DYNAMIC_RUNTIME_MODES: ReadonlySet<string> = new Set(["sandbox", "authorized_staging"]);

/** True for the runtime modes that send real HTTP requests to a target. */
export function isDynamicRuntimeModeName(mode: string | null | undefined): boolean {
  return mode != null && DYNAMIC_RUNTIME_MODES.has(mode);
}
