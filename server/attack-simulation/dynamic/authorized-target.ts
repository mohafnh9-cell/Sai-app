import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import { validateAttackAuthorization } from "@/server/ai-red-team/authorization/types";
import type { AttackRuntimeMode } from "../contracts/enums";
import type { SafeRuntimeGuardContext } from "../runtime/types";

export type DynamicAttackMode = "mock" | "sandbox" | "authorized_staging" | "production_dynamic";

export type AuthorizedDynamicTarget = {
  baseUrl: string;
  origin: string;
  environment: AttackAuthorizationRecord["environmentType"] | "sandbox";
  authorized: boolean;
  authorization: AttackAuthorizationRecord | null;
  allowedPaths: string[];
  pathExclusions: string[];
  maxRequestBudget: number;
  maxDurationMs: number;
  attackMode: DynamicAttackMode;
  testIdentities: {
    userA?: { token?: string; label: string };
    userB?: { token?: string; label: string };
    admin?: { token?: string; label: string };
  };
};

export type DynamicTargetFixtures = {
  paths?: Partial<Record<string, string>>;
  webhookSecret?: string;
  ssrfCallbackPath?: string;
};

const DEFAULT_LAB_PATHS: DynamicTargetFixtures["paths"] = {
  unauthenticated: "/api/public/profile",
  authenticated: "/api/secure/profile",
  idorResourceA: "/api/orders/user-a",
  idorResourceB: "/api/orders/user-b",
  idorResourceBProtected: "/api/orders/user-b-protected",
  rateLimitVulnerable: "/api/login",
  rateLimitProtected: "/api/login-protected",
  webhook: "/api/webhook",
  idempotent: "/api/idempotent",
  massAssignment: "/api/users",
  privilegeEscalation: "/api/admin/stats",
  cors: "/api/cors-test",
  securityHeaders: "/",
  securityHeadersSecure: "/secure-headers",
  ssrf: "/api/outbound-fetch",
  injectionEcho: "/api/echo",
};

export function isDynamicRuntimeMode(mode: AttackRuntimeMode): boolean {
  return mode === "sandbox" || mode === "authorized_staging";
}

export function resolveAuthorizedDynamicTarget(input: {
  guard: SafeRuntimeGuardContext;
  fixtures?: DynamicTargetFixtures;
}): AuthorizedDynamicTarget | null {
  const url = input.guard.network.url;
  if (!url || !isDynamicRuntimeMode(input.guard.mode)) return null;

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }

  const authorization = input.guard.authorization ?? null;
  if (input.guard.mode === "authorized_staging") {
    if (!authorization) return null;
    const validation = validateAttackAuthorization(authorization, { targetUrl: url });
    if (!validation.ok) return null;
  }

  const scopePaths = Array.isArray(authorization?.approvedScope?.allowedPaths)
    ? (authorization!.approvedScope.allowedPaths as string[])
    : ["/api", "/"];

  return {
    baseUrl: url.replace(/\/$/, ""),
    origin,
    environment: authorization?.environmentType ?? "sandbox",
    authorized: input.guard.mode === "authorized_staging",
    authorization,
    allowedPaths: scopePaths,
    pathExclusions: authorization?.pathExclusions ?? [],
    maxRequestBudget: input.guard.limits.maxRequestBudget,
    maxDurationMs: input.guard.limits.maxDurationMs,
    attackMode:
      authorization?.environmentType === "production_safe"
        ? "production_dynamic"
        : input.guard.mode === "authorized_staging"
          ? "authorized_staging"
          : "sandbox",
    testIdentities: {
      userA: { token: "test-token-user-a", label: "user_a" },
      userB: { token: "test-token-user-b", label: "user_b" },
      admin: { token: "test-token-admin", label: "admin" },
    },
  };
}

export function resolveProbePath(
  target: AuthorizedDynamicTarget,
  fixtures: DynamicTargetFixtures | undefined,
  key: keyof NonNullable<DynamicTargetFixtures["paths"]>
): string {
  return fixtures?.paths?.[key] ?? DEFAULT_LAB_PATHS?.[key] ?? "/";
}

export function assertPathAllowed(target: AuthorizedDynamicTarget, path: string): void {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  for (const excluded of target.pathExclusions) {
    if (normalized.startsWith(excluded)) {
      throw new Error(`Path ${normalized} is excluded by authorization`);
    }
  }
  const allowed = target.allowedPaths.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  if (!allowed && target.authorized) {
    throw new Error(`Path ${normalized} is outside authorized scope`);
  }
}

export function resolveSandboxLabOriginFromEnv(): string | null {
  const raw = process.env.SEQURAI_DYNAMIC_LAB_ORIGIN?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function resolveSandboxLabFixturesFromEnv(): DynamicTargetFixtures | undefined {
  type PathKey = keyof NonNullable<DynamicTargetFixtures["paths"]>;
  const envPathMappings: Array<[PathKey, string]> = [
    ["idorResourceB", "SEQURAI_DYNAMIC_LAB_IDOR_PATH"],
    ["idempotent", "SEQURAI_DYNAMIC_LAB_IDEMPOTENCY_PATH"],
    ["securityHeaders", "SEQURAI_DYNAMIC_LAB_SECURITY_HEADERS_PATH"],
    ["webhook", "SEQURAI_DYNAMIC_LAB_WEBHOOK_PATH"],
    ["massAssignment", "SEQURAI_DYNAMIC_LAB_MASS_ASSIGNMENT_PATH"],
    ["privilegeEscalation", "SEQURAI_DYNAMIC_LAB_PRIVILEGE_ESCALATION_PATH"],
    ["injectionEcho", "SEQURAI_DYNAMIC_LAB_INJECTION_PATH"],
    ["ssrf", "SEQURAI_DYNAMIC_LAB_SSRF_PATH"],
    ["cors", "SEQURAI_DYNAMIC_LAB_CORS_PATH"],
  ];

  const paths: NonNullable<DynamicTargetFixtures["paths"]> = {};
  for (const [key, envVar] of envPathMappings) {
    const value = process.env[envVar]?.trim();
    if (value) paths[key] = value;
  }

  return Object.keys(paths).length > 0 ? { paths } : undefined;
}
