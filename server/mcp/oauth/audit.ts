import "server-only";

export type OAuthAuditEventType =
  | "oauth.authorization.started"
  | "oauth.authorization.denied"
  | "oauth.authorization.completed"
  | "oauth.token.issued"
  | "oauth.token.refreshed"
  | "oauth.token.revoked"
  | "oauth.refresh.reuse_detected"
  | "oauth.client.registered"
  | "oauth.scope.denied";

export type OAuthAuditEvent = {
  eventType: OAuthAuditEventType;
  userId?: string | null;
  organizationId?: string | null;
  clientId?: string | null;
  scopes?: string[];
  result: "success" | "denied" | "error";
  ip?: string | null;
  metadata?: Record<string, unknown>;
};

const FORBIDDEN_OAUTH_LOG_KEYS = new Set([
  "access_token",
  "refresh_token",
  "authorization_code",
  "code_verifier",
  "code_challenge",
  "token",
  "apiKey",
  "api_key",
  "key_hash",
  "token_hash",
  "code_hash",
]);

export function logOAuthEvent(event: OAuthAuditEvent): void {
  const safeMetadata = event.metadata
    ? Object.fromEntries(
        Object.entries(event.metadata).filter(([key]) => !FORBIDDEN_OAUTH_LOG_KEYS.has(key))
      )
    : undefined;

  console.info({
    component: "mcp-oauth-audit",
    eventType: event.eventType,
    userId: event.userId ?? null,
    organizationId: event.organizationId ?? null,
    clientId: event.clientId ?? null,
    scopes: event.scopes ?? [],
    result: event.result,
    ip: event.ip ?? null,
    timestamp: new Date().toISOString(),
    ...(safeMetadata && Object.keys(safeMetadata).length > 0 ? { metadata: safeMetadata } : {}),
  });
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? null;
}
