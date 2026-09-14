import "server-only";

import { listExternalAndNativeAdjacentEngines } from "@/server/security-engines/registry";
import type { EngineId } from "@/server/security-engines/types";
import type { SecurityPlan } from "./types";

/**
 * Phase 36, section 17/18: AI may INFLUENCE a plan (e.g. suggest depth,
 * explain rationale, prioritize which findings to investigate first) but
 * never directly control execution primitives. This is the deterministic
 * gate every AI-touched plan must pass before a single SecurityJob is
 * created from it -- it re-derives the set of valid engine ids from the
 * SAME registry the planner itself uses (never a hardcoded list that could
 * drift), and rejects anything outside it: an unregistered engine id, a
 * capability an engine doesn't actually declare, or a tenant/scan mismatch.
 */
export class SecurityPlanValidationError extends Error {
  constructor(public readonly violations: string[]) {
    super(`Invalid security plan: ${violations.join("; ")}`);
    this.name = "SecurityPlanValidationError";
  }
}

function registeredEngineIds(): Set<EngineId> {
  return new Set<EngineId>(["native", ...listExternalAndNativeAdjacentEngines().map((e) => e.id)]);
}

export function validateSecurityPlan(
  plan: SecurityPlan,
  expected: { organizationId: string; projectId: string; scanId: string }
): void {
  const violations: string[] = [];
  const validEngineIds = registeredEngineIds();
  const capabilitiesByEngine = new Map(
    listExternalAndNativeAdjacentEngines().map((e) => [e.id, new Set(e.capabilities.map((c) => c.id))])
  );

  if (plan.organizationId !== expected.organizationId) violations.push("organizationId does not match the authorized scan context");
  if (plan.projectId !== expected.projectId) violations.push("projectId does not match the authorized scan context");
  if (plan.scanId !== expected.scanId) violations.push("scanId does not match the authorized scan context");

  for (const decision of plan.decisions) {
    if (!validEngineIds.has(decision.engine)) {
      violations.push(`engine "${decision.engine}" is not a registered engine`);
      continue;
    }
    if (decision.engine === "native") continue; // native has no SecurityEngine capability list to check against
    const allowedCapabilities = capabilitiesByEngine.get(decision.engine) ?? new Set();
    for (const capability of decision.capabilities) {
      if (!allowedCapabilities.has(capability)) {
        violations.push(`engine "${decision.engine}" does not declare capability "${capability}"`);
      }
    }
  }

  for (const selected of plan.selectedEngines) {
    if (!validEngineIds.has(selected)) {
      violations.push(`selectedEngines references unregistered engine "${selected}"`);
    }
  }

  if (plan.dynamicTestingAvailable) {
    // Section 15/18: this must never be true from an AI-influenced plan --
    // it is derived exclusively from isNetworkEgressEnforced() in the
    // deterministic planner, never something AI can set directly.
    violations.push("dynamicTestingAvailable=true is not permitted from a plan not produced by the deterministic planner");
  }

  if (violations.length > 0) {
    throw new SecurityPlanValidationError(violations);
  }
}
