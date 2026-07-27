export type AttackEnvironmentType = "local" | "preview" | "staging" | "production_safe";

export type AttackAuthorizationStatus = "pending" | "approved" | "revoked" | "expired";

export type AttackAuthorizationRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  targetOrigin: string;
  environmentType: AttackEnvironmentType;
  status: AttackAuthorizationStatus;
  authorizationMethod: string;
  approvedScope: Record<string, unknown>;
  createdBy: string | null;
  approvedAt: string;
  expiresAt: string;
  testCredentialsRef: string | null;
  pathExclusions: string[];
  redirectAllowlist: string[];
  maxRequestBudget: number;
  maxDurationSeconds: number;
  commitSha: string | null;
};

export type AuthorizationValidationResult =
  | { ok: true; authorization: AttackAuthorizationRecord }
  | { ok: false; code: string; message: string };

export function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Origin must be http or https");
  }
  return url.origin;
}

export function isOriginAllowed(
  navigationUrl: string,
  allowedOrigin: string,
  redirectAllowlist: string[]
): boolean {
  const target = new URL(navigationUrl);
  const allowed = normalizeOrigin(allowedOrigin);
  if (target.origin === allowed) return true;
  return redirectAllowlist.map(normalizeOrigin).includes(target.origin);
}

export function validateAttackAuthorization(
  authorization: AttackAuthorizationRecord,
  input: { targetUrl: string; nowMs?: number }
): AuthorizationValidationResult {
  const now = input.nowMs ?? Date.now();
  if (authorization.status !== "approved") {
    return { ok: false, code: "AUTHORIZATION_NOT_APPROVED", message: "Authorization is not approved" };
  }
  if (Date.parse(authorization.expiresAt) <= now) {
    return { ok: false, code: "AUTHORIZATION_EXPIRED", message: "Authorization has expired" };
  }
  let targetOrigin: string;
  try {
    targetOrigin = normalizeOrigin(new URL(input.targetUrl).origin);
  } catch {
    return { ok: false, code: "INVALID_TARGET_URL", message: "Target URL is invalid" };
  }
  if (normalizeOrigin(authorization.targetOrigin) !== targetOrigin) {
    return { ok: false, code: "ORIGIN_MISMATCH", message: "Target origin does not match authorization" };
  }
  if (authorization.environmentType === "production_safe") {
    // production_safe runs are allowed but specialists must stay non-destructive (enforced in runtime)
  }
  return { ok: true, authorization };
}

export function isDestructiveActionHint(input: {
  path?: string;
  method?: string;
  label?: string;
  name?: string;
}): boolean {
  const haystack = `${input.path ?? ""} ${input.label ?? ""} ${input.name ?? ""}`.toLowerCase();
  const destructive =
    /\b(delete|remove|purchase|pay\b|confirm order|send\b|publish|transfer|cancel subscription|invite|api key|regenerate secret|deploy|merge)\b/i;
  if (destructive.test(haystack)) return true;
  const method = (input.method ?? "GET").toUpperCase();
  if (["DELETE", "PUT", "PATCH"].includes(method) && destructive.test(haystack)) return true;
  return false;
}
