import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import { validateAttackAuthorization } from "@/server/ai-red-team/authorization/types";
import type { AttackRuntimeMode } from "../contracts/enums";
import type { SafeRuntimeGuardContext, SafeRuntimeGuardLimits, SafeRuntimeGuardResult, SafeRuntimeNetworkIntent } from "./types";

const NO_EXTERNAL_TARGET_MODES: AttackRuntimeMode[] = ["static", "mock"];

export function assertTenantOwnership(context: SafeRuntimeGuardContext): SafeRuntimeGuardResult {
  if (!context.tenant.organizationId || !context.tenant.projectId) {
    return {
      ok: false,
      violation: { code: "TENANT_CONTEXT_MISSING", message: "Tenant context is incomplete" },
    };
  }
  if (context.authorization) {
    if (context.authorization.organizationId !== context.tenant.organizationId) {
      return {
        ok: false,
        violation: { code: "AUTHORIZATION_TENANT_MISMATCH", message: "Authorization tenant mismatch" },
      };
    }
    if (context.authorization.projectId !== context.tenant.projectId) {
      return {
        ok: false,
        violation: { code: "AUTHORIZATION_PROJECT_MISMATCH", message: "Authorization project mismatch" },
      };
    }
  }
  return { ok: true };
}

export function assertRuntimeModeAllowed(mode: AttackRuntimeMode): SafeRuntimeGuardResult {
  if (mode === "blocked" || mode === "unsupported") {
    return {
      ok: false,
      violation: { code: "RUNTIME_MODE_BLOCKED", message: `Runtime mode ${mode} cannot execute` },
    };
  }
  return { ok: true };
}

export function assertTargetAllowlisted(
  context: SafeRuntimeGuardContext
): SafeRuntimeGuardResult {
  if (NO_EXTERNAL_TARGET_MODES.includes(context.mode)) {
    if (context.network.url) {
      return {
        ok: false,
        violation: {
          code: "EXTERNAL_TARGET_DISALLOWED",
          message: "External targets are not allowed for internal runtimes",
        },
      };
    }
    return { ok: true };
  }

  if (context.mode === "authorized_staging") {
    if (!context.authorization) {
      return {
        ok: false,
        violation: {
          code: "AUTHORIZATION_REQUIRED",
          message: "Authorized staging requires an active authorization",
        },
      };
    }
    if (!context.network.url) {
      return { ok: true };
    }
    const authResult = validateAttackAuthorization(context.authorization, {
      targetUrl: context.network.url,
      nowMs: context.nowMs,
    });
    if (!authResult.ok) {
      return {
        ok: false,
        violation: { code: authResult.code, message: authResult.message },
      };
    }
  }

  return { ok: true };
}

export function assertNetworkRestrictions(
  context: SafeRuntimeGuardContext,
  options?: { sandboxAllowlist?: string[] }
): SafeRuntimeGuardResult {
  const intent = context.network;
  if (intent.kind === "none" || !intent.url) return { ok: true };

  if (context.mode === "static" || context.mode === "mock") {
    return {
      ok: false,
      violation: {
        code: "NETWORK_FORBIDDEN",
        message: "Network access is forbidden for static and mock runtimes",
      },
    };
  }

  if (context.mode === "sandbox") {
    let hostname: string;
    try {
      hostname = new URL(intent.url).hostname.toLowerCase();
    } catch {
      return {
        ok: false,
        violation: { code: "INVALID_NETWORK_URL", message: "Network URL is invalid" },
      };
    }
    const allowlist = (options?.sandboxAllowlist ?? DEFAULT_SANDBOX_HOST_ALLOWLIST).map((h) =>
      h.toLowerCase()
    );
    const allowed = allowlist.some(
      (entry) => hostname === entry || hostname.endsWith(`.${entry}`)
    );
    if (!allowed) {
      return {
        ok: false,
        violation: {
          code: "SANDBOX_HOST_NOT_ALLOWLISTED",
          message: `Sandbox host ${hostname} is not allowlisted`,
        },
      };
    }
  }

  return { ok: true };
}

export const DEFAULT_SANDBOX_HOST_ALLOWLIST = ["localhost", "127.0.0.1", "sandbox.sequrai.local"];

export function assertRequestBudget(context: SafeRuntimeGuardContext): SafeRuntimeGuardResult {
  if (context.requestsConsumed >= context.limits.maxRequestBudget) {
    return {
      ok: false,
      violation: { code: "REQUEST_BUDGET_EXCEEDED", message: "Request budget exceeded" },
    };
  }
  return { ok: true };
}

export function assertTimeout(context: SafeRuntimeGuardContext): SafeRuntimeGuardResult {
  const now = context.nowMs ?? Date.now();
  if (now - context.startedAtMs > context.limits.maxDurationMs) {
    return {
      ok: false,
      violation: { code: "RUNTIME_TIMEOUT", message: "Execution exceeded maximum duration" },
    };
  }
  return { ok: true };
}

export function assertCancellation(context: SafeRuntimeGuardContext): SafeRuntimeGuardResult {
  if (context.cancelled) {
    return {
      ok: false,
      violation: { code: "EXECUTION_CANCELLED", message: "Execution was cancelled" },
    };
  }
  if (context.emergencyStop) {
    return {
      ok: false,
      violation: { code: "EMERGENCY_STOP", message: "Emergency stop is active" },
    };
  }
  return { ok: true };
}

export function enforceSafeRuntimeGuards(
  context: SafeRuntimeGuardContext,
  options?: { sandboxAllowlist?: string[] }
): SafeRuntimeGuardResult {
  const checks = [
    assertRuntimeModeAllowed(context.mode),
    assertTenantOwnership(context),
    assertTargetAllowlisted(context),
    assertNetworkRestrictions(context, options),
    assertRequestBudget(context),
    assertTimeout(context),
    assertCancellation(context),
  ];
  for (const result of checks) {
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function authorizationBudgetLimits(
  authorization?: AttackAuthorizationRecord | null
): SafeRuntimeGuardLimits {
  return {
    maxRequestBudget: authorization?.maxRequestBudget ?? 50,
    maxDurationMs: (authorization?.maxDurationSeconds ?? 900) * 1000,
    maxConcurrentRequests: 3,
  };
}

export function networkIntentFromTarget(
  mode: AttackRuntimeMode,
  targetUrl?: string | null
): SafeRuntimeNetworkIntent {
  if (!targetUrl) return { kind: "none" };
  if (mode === "static" || mode === "mock") {
    return { kind: "fixture", url: targetUrl, method: "GET" };
  }
  return { kind: "http", url: targetUrl, method: "GET" };
}
