import { createHmac } from "node:crypto";

export type LabState = {
  idempotency: Map<string, string>;
  rateLimitCounter: number;
};

export type LabHttpRequest = {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  body?: string;
};

export type LabHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

const globalForLab = globalThis as typeof globalThis & {
  __sequraiDynamicSecurityLabState?: LabState;
};

function getLabState(): LabState {
  if (!globalForLab.__sequraiDynamicSecurityLabState) {
    globalForLab.__sequraiDynamicSecurityLabState = {
      idempotency: new Map(),
      rateLimitCounter: 0,
    };
  }
  return globalForLab.__sequraiDynamicSecurityLabState;
}

export function resetLabState(): void {
  const state = getLabState();
  state.idempotency.clear();
  state.rateLimitCounter = 0;
}

function readHeader(
  headers: LabHttpRequest["headers"],
  name: string
): string | undefined {
  const value = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): LabHttpResponse {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
    body,
  };
}

function parseAuth(headers: LabHttpRequest["headers"]): string | null {
  const header = readHeader(headers, "authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

function resolveWebhookSecret(): string {
  return process.env.SEQURAI_LAB_WEBHOOK_SECRET?.trim() || "lab-webhook-secret";
}

export async function handleDynamicSecurityLabRequest(
  req: LabHttpRequest
): Promise<LabHttpResponse> {
  const state = getLabState();
  const method = req.method.toUpperCase();
  const auth = parseAuth(req.headers);
  const protectPublicProfile = process.env.SEQURAI_LAB_PROTECT_PUBLIC_PROFILE === "1";

  if (method === "GET" && req.pathname === "/health") {
    return jsonResponse(200, {
      ok: true,
      service: "dynamic-security-lab",
      synthetic: true,
    });
  }

  if (method === "OPTIONS" && req.pathname === "/api/cors-test") {
    const protectCors = process.env.SEQURAI_LAB_CORS_PROTECTED === "1";
    if (protectCors) {
      return {
        status: 204,
        headers: {
          "access-control-allow-origin": "https://trusted.sequrai.test",
          "access-control-allow-credentials": "false",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          vary: "Origin",
        },
        body: null,
      };
    }
    return {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      },
      body: null,
    };
  }

  if (method === "GET" && req.pathname === "/api/public/profile") {
    if (protectPublicProfile && !auth) {
      return jsonResponse(401, { error: "unauthorized", message: "authentication required" });
    }
    return jsonResponse(200, {
      id: "public-profile",
      email: "public@sequrai.test",
      sensitive: true,
    });
  }

  if (method === "GET" && req.pathname === "/api/secure/profile") {
    if (!auth) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    return jsonResponse(200, {
      id: "secure-profile",
      role: auth.includes("admin") ? "admin" : "user",
    });
  }

  if (method === "GET" && req.pathname === "/api/orders/user-a") {
    return jsonResponse(200, { owner: "user-a", orderId: "order-a", total: 10 });
  }

  if (method === "GET" && req.pathname === "/api/orders/user-b-protected") {
    return jsonResponse(403, { error: "forbidden", message: "cross-tenant access denied" });
  }

  if (method === "GET" && req.pathname === "/api/orders/user-b") {
    const protectIdor = process.env.SEQURAI_LAB_IDOR_PROTECTED === "1";
    if (protectIdor || auth !== "test-token-user-a") {
      return jsonResponse(403, { error: "forbidden", message: "cross-tenant access denied" });
    }
    return jsonResponse(200, {
      owner: "user-b",
      orderId: "order-b",
      tenant: "tenant-b",
      foreignRecord: true,
    });
  }

  if (method === "POST" && req.pathname === "/api/login") {
    return jsonResponse(200, { accepted: true, note: "no rate limiting on this endpoint" });
  }

  if (method === "POST" && req.pathname === "/api/login-protected") {
    state.rateLimitCounter += 1;
    if (state.rateLimitCounter > 5) {
      return jsonResponse(429, { error: "too_many_requests" }, { "retry-after": "1" });
    }
    return jsonResponse(200, { accepted: true, throttled: false });
  }

  if (method === "POST" && req.pathname === "/api/webhook") {
    const body = req.body ?? "";
    const unprotected = process.env.SEQURAI_LAB_WEBHOOK_UNPROTECTED === "1";
    if (unprotected) {
      return jsonResponse(200, { accepted: true, verified: false, signatureChecked: false });
    }
    const signature = readHeader(req.headers, "x-signature");
    const expected = createHmac("sha256", resolveWebhookSecret()).update(body).digest("hex");
    if (!signature || signature !== expected) {
      return jsonResponse(401, { error: "invalid signature rejected" });
    }
    return jsonResponse(200, { accepted: true, verified: true });
  }

  if (method === "POST" && req.pathname === "/api/idempotent-vulnerable") {
    const key = readHeader(req.headers, "idempotency-key") ?? "";
    if (!key) {
      return jsonResponse(400, { error: "missing idempotency key" });
    }
    const resultId = `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return jsonResponse(200, { idempotent: false, resultId, duplicateOperation: true });
  }

  if (method === "POST" && req.pathname === "/api/idempotent") {
    const key = readHeader(req.headers, "idempotency-key") ?? "";
    if (!key) {
      return jsonResponse(400, { error: "missing idempotency key" });
    }
    const existing = state.idempotency.get(key);
    if (existing) {
      return jsonResponse(200, { idempotent: true, sameResult: true, resultId: existing });
    }
    const resultId = `result-${key.slice(0, 8)}`;
    state.idempotency.set(key, resultId);
    return jsonResponse(200, { idempotent: false, resultId });
  }

  if (method === "POST" && req.pathname === "/api/users") {
    const body = JSON.parse(req.body ?? "{}") as { role?: string };
    const protectMassAssignment = process.env.SEQURAI_LAB_MASS_ASSIGNMENT_PROTECTED === "1";
    if (protectMassAssignment && body.role === "admin") {
      return jsonResponse(403, {
        error: "forbidden",
        role: "user",
        privilegedFieldAccepted: false,
      });
    }
    if (body.role === "admin") {
      return jsonResponse(200, { id: "user-probe", role: "admin", privilegedFieldAccepted: true });
    }
    return jsonResponse(200, { id: "user-probe", role: "user", privilegedFieldAccepted: false });
  }

  if (method === "GET" && req.pathname === "/api/admin/stats") {
    const allowEscalation = process.env.SEQURAI_LAB_PRIVILEGE_ESCALATION_VULNERABLE === "1";
    if (allowEscalation || auth === "test-token-admin") {
      return jsonResponse(200, { admin: true, stats: { users: 1 }, privileged: true });
    }
    return jsonResponse(403, { error: "admin access denied" });
  }

  if (method === "GET" && req.pathname === "/api/echo") {
    const query = req.searchParams.get("q") ?? "";
    const protectInjection = process.env.SEQURAI_LAB_INJECTION_PROTECTED === "1";
    if (protectInjection) {
      return jsonResponse(200, { echo: "[sanitized]", sanitized: true, payloadReflected: false });
    }
    return jsonResponse(200, { echo: query });
  }

  if (method === "GET" && req.pathname === "/api/outbound-fetch") {
    const target = req.searchParams.get("url");
    if (!target) {
      return jsonResponse(400, { error: "missing url" });
    }
    const allowSsrfCanary = process.env.SEQURAI_LAB_SSRF_VULNERABLE === "1";
    if (allowSsrfCanary && target === "http://127.0.0.1:9/probe") {
      return jsonResponse(200, { fetched: target, internalFetch: true });
    }
    if (/127\.0\.0\.1|169\.254\.169\.254|metadata/i.test(target)) {
      return jsonResponse(400, {
        error: "internal/metadata URLs blocked",
        internalFetch: false,
      });
    }
    return jsonResponse(200, { fetched: target, internalFetch: true });
  }

  if (method === "GET" && req.pathname === "/secure-headers") {
    return jsonResponse(
      200,
      { ok: true },
      {
        "content-security-policy": "default-src 'self'",
        "strict-transport-security": "max-age=31536000",
        "x-content-type-options": "nosniff",
      }
    );
  }

  if (method === "GET" && req.pathname === "/") {
    return jsonResponse(200, { ok: true, lab: "dynamic-security-lab" });
  }

  return jsonResponse(404, { error: "not_found", path: req.pathname });
}
