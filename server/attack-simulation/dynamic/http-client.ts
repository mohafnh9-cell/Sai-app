import { createHash } from "node:crypto";
import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import { isOriginAllowed } from "@/server/ai-red-team/authorization/types";
import { assertSafeApiRequest } from "@/server/ai-red-team/teams/api/runtime/safe-api-runtime";
import { redactAttackSecrets, redactAttackUrl } from "../evidence/redact";
import type { DynamicHttpConcurrencyLimiter } from "./concurrency-limiter";
import type { AuthorizedDynamicTarget } from "./authorized-target";
import { assertPathAllowed } from "./authorized-target";

export type DynamicHttpRequest = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  label?: string;
};

export type DynamicHttpResponseEvidence = {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  durationMs: number;
  headers: Record<string, string>;
  bodyLength: number;
  bodyFingerprint: string;
  bodyPreview: string;
  correlationId: string;
  testIdentity: string | null;
  timestamp: string;
};

export type DynamicHttpClient = {
  request(input: DynamicHttpRequest): Promise<DynamicHttpResponseEvidence>;
  requestsSent: number;
};

const REDACTED_HEADER_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

function sanitizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = REDACTED_HEADER_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  });
  return out;
}

function bodyPreview(text: string, max = 240): string {
  const redacted = redactAttackSecrets(text);
  return redacted.length <= max ? redacted : `${redacted.slice(0, max)}…`;
}

function fingerprintBody(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function resolveRequestAuthorization(
  target: AuthorizedDynamicTarget
): AttackAuthorizationRecord {
  if (target.authorization) return target.authorization;
  return authorizationForSandboxOrigin(target.origin);
}

function assertRedirectWithinScope(input: {
  response: Response;
  target: AuthorizedDynamicTarget;
  authorization: AttackAuthorizationRecord;
  requestUrl: string;
}): void {
  if (input.response.status < 300 || input.response.status >= 400) return;

  const location = input.response.headers.get("location");
  if (!location) return;

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(location, input.requestUrl);
  } catch {
    throw new Error("Redirect blocked: invalid Location header");
  }

  if (
    !isOriginAllowed(
      redirectUrl.toString(),
      input.authorization.targetOrigin,
      input.authorization.redirectAllowlist
    )
  ) {
    throw new Error("Redirect blocked: location hostname outside authorized scope");
  }

  assertPathAllowed(input.target, redirectUrl.pathname);
}

export function createDynamicHttpClient(input: {
  target: AuthorizedDynamicTarget;
  correlationId: string;
  timeoutMs?: number;
  onRequestConsumed?: () => void;
  concurrencyLimiter?: DynamicHttpConcurrencyLimiter;
  isCancelled?: () => boolean;
}): DynamicHttpClient {
  let requestsSent = 0;
  const timeoutMs = input.timeoutMs ?? 8_000;

  async function request(req: DynamicHttpRequest): Promise<DynamicHttpResponseEvidence> {
    if (requestsSent >= input.target.maxRequestBudget) {
      throw new Error("Dynamic HTTP request budget exceeded");
    }
    assertPathAllowed(input.target, req.path);

    const method = req.method.toUpperCase();
    const url = new URL(req.path, input.target.origin).toString();
    const authorization = resolveRequestAuthorization(input.target);

    assertSafeApiRequest({
      method,
      path: req.path,
      authorization,
      origin: input.target.origin,
    });

    if (method === "DELETE") {
      throw new Error("DELETE requests are not permitted in dynamic security probes");
    }

    let permitHeld = false;
    try {
      if (input.concurrencyLimiter) {
        await input.concurrencyLimiter.acquire({ isCancelled: input.isCancelled });
        permitHeld = true;
      }

      if (input.isCancelled?.()) {
        throw new Error("Dynamic HTTP request cancelled");
      }
      if (requestsSent >= input.target.maxRequestBudget) {
        throw new Error("Dynamic HTTP request budget exceeded");
      }

      requestsSent += 1;
      input.onRequestConsumed?.();

      const headers = new Headers(req.headers ?? {});
      headers.set("user-agent", "SequrAI-DynamicSecurity/1.0");
      headers.set("x-sequrai-correlation-id", input.correlationId);
      if (req.body != null && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }

      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: req.body != null ? JSON.stringify(req.body) : undefined,
          signal: controller.signal,
          redirect: "manual",
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Dynamic HTTP request timed out");
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }

      assertRedirectWithinScope({
        response,
        target: input.target,
        authorization,
        requestUrl: url,
      });

      const text = await response.text().catch(() => "");
      const durationMs = Date.now() - started;

      return {
        url: redactAttackUrl(url) ?? url,
        method,
        status: response.status,
        ok: response.ok,
        durationMs,
        headers: sanitizeHeaders(response.headers),
        bodyLength: text.length,
        bodyFingerprint: fingerprintBody(text),
        bodyPreview: bodyPreview(text),
        correlationId: input.correlationId,
        testIdentity: req.label ?? null,
        timestamp: new Date().toISOString(),
      };
    } finally {
      if (permitHeld && input.concurrencyLimiter) {
        input.concurrencyLimiter.release();
      }
    }
  }

  return {
    request,
    get requestsSent() {
      return requestsSent;
    },
  };
}

export function authorizationForSandboxOrigin(origin: string): AttackAuthorizationRecord {
  const now = Date.now();
  return {
    id: "00000000-0000-4000-8000-000000000099",
    organizationId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    targetOrigin: origin,
    environmentType: "local",
    status: "approved",
    authorizationMethod: "local_lab",
    approvedScope: { allowedPaths: ["/api", "/secure-headers", "/"] },
    createdBy: null,
    approvedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    testCredentialsRef: null,
    pathExclusions: [],
    redirectAllowlist: [],
    maxRequestBudget: 120,
    maxDurationSeconds: 900,
    commitSha: null,
  };
}
