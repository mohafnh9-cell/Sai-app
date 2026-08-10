import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import { validateAttackAuthorization } from "@/server/ai-red-team/authorization/types";

/** Production dynamic HTTP probes stay off unless this env flag is explicitly set. */
export function isProductionDynamicExplicitlyEnabled(): boolean {
  return process.env.SEQURAI_PRODUCTION_DYNAMIC_ENABLED === "true";
}

export type ProductionDynamicGateResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export function validateProductionDynamicGate(
  authorization: AttackAuthorizationRecord | null | undefined,
  input?: { targetUrl?: string | null; nowMs?: number }
): ProductionDynamicGateResult {
  if (!authorization || authorization.environmentType !== "production_safe") {
    return { ok: true };
  }

  if (!isProductionDynamicExplicitlyEnabled()) {
    return {
      ok: false,
      code: "PRODUCTION_DYNAMIC_DISABLED",
      message:
        "Production dynamic testing is disabled by default and requires explicit enablement",
    };
  }

  if (authorization.maxRequestBudget <= 0) {
    return {
      ok: false,
      code: "PRODUCTION_BUDGET_MISSING",
      message: "Production dynamic testing requires a positive request budget",
    };
  }

  if (authorization.maxDurationSeconds <= 0) {
    return {
      ok: false,
      code: "PRODUCTION_TIMEOUT_MISSING",
      message: "Production dynamic testing requires a positive timeout duration",
    };
  }

  const scopePaths = authorization.approvedScope?.allowedPaths;
  if (!Array.isArray(scopePaths) || scopePaths.length === 0) {
    return {
      ok: false,
      code: "PRODUCTION_SCOPE_MISSING",
      message: "Production dynamic testing requires an explicit allowed path scope",
    };
  }

  if (input?.targetUrl) {
    const authResult = validateAttackAuthorization(authorization, {
      targetUrl: input.targetUrl,
      nowMs: input.nowMs,
    });
    if (!authResult.ok) {
      return { ok: false, code: authResult.code, message: authResult.message };
    }
  }

  return { ok: true };
}
