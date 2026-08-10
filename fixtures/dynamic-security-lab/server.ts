import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac } from "node:crypto";

type LabState = {
  idempotency: Map<string, string>;
  rateLimitCounter: number;
};

const WEBHOOK_SECRET = "lab-webhook-secret";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function parseAuth(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

export type DynamicSecurityLab = {
  server: Server;
  origin: string;
  port: number;
  resetState(): void;
  close(): Promise<void>;
};

export async function startDynamicSecurityLab(port = 0): Promise<DynamicSecurityLab> {
  const state: LabState = { idempotency: new Map(), rateLimitCounter: 0 };
  const protectPublicProfile = process.env.SEQURAI_LAB_PROTECT_PUBLIC_PROFILE === "1";

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = (req.method ?? "GET").toUpperCase();
    const auth = parseAuth(req);

    if (method === "OPTIONS" && url.pathname === "/api/cors-test") {
      const protectCors = process.env.SEQURAI_LAB_CORS_PROTECTED === "1";
      if (protectCors) {
        res.writeHead(204, {
          "access-control-allow-origin": "https://trusted.sequrai.test",
          "access-control-allow-credentials": "false",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          vary: "Origin",
        });
        res.end();
        return;
      }
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      });
      res.end();
      return;
    }

    if (method === "GET" && url.pathname === "/api/public/profile") {
      if (protectPublicProfile && !auth) {
        json(res, 401, { error: "unauthorized", message: "authentication required" });
        return;
      }
      json(res, 200, { id: "public-profile", email: "public@sequrai.test", sensitive: true });
      return;
    }

    if (method === "GET" && url.pathname === "/api/secure/profile") {
      if (!auth) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      json(res, 200, { id: "secure-profile", role: auth.includes("admin") ? "admin" : "user" });
      return;
    }

    if (method === "GET" && url.pathname === "/api/orders/user-a") {
      json(res, 200, { owner: "user-a", orderId: "order-a", total: 10 });
      return;
    }

    if (method === "GET" && url.pathname === "/api/orders/user-b-protected") {
      json(res, 403, { error: "forbidden", message: "cross-tenant access denied" });
      return;
    }

    if (method === "GET" && url.pathname === "/api/orders/user-b") {
      const protectIdor = process.env.SEQURAI_LAB_IDOR_PROTECTED === "1";
      if (protectIdor || auth !== "test-token-user-a") {
        json(res, 403, { error: "forbidden", message: "cross-tenant access denied" });
        return;
      }
      json(res, 200, { owner: "user-b", orderId: "order-b", tenant: "tenant-b", foreignRecord: true });
      return;
    }

    if (method === "POST" && url.pathname === "/api/login") {
      json(res, 200, { accepted: true, note: "no rate limiting on this endpoint" });
      return;
    }

    if (method === "POST" && url.pathname === "/api/login-protected") {
      state.rateLimitCounter += 1;
      if (state.rateLimitCounter > 5) {
        json(res, 429, { error: "too_many_requests" }, { "retry-after": "1" });
        return;
      }
      json(res, 200, { accepted: true, throttled: false });
      return;
    }

    if (method === "POST" && url.pathname === "/api/webhook") {
      const body = await readBody(req);
      const unprotected = process.env.SEQURAI_LAB_WEBHOOK_UNPROTECTED === "1";
      if (unprotected) {
        json(res, 200, { accepted: true, verified: false, signatureChecked: false });
        return;
      }
      const signature = req.headers["x-signature"];
      const expected = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
      if (!signature || signature !== expected) {
        json(res, 401, { error: "invalid signature rejected" });
        return;
      }
      json(res, 200, { accepted: true, verified: true });
      return;
    }

    if (method === "POST" && url.pathname === "/api/idempotent-vulnerable") {
      const key = String(req.headers["idempotency-key"] ?? "");
      if (!key) {
        json(res, 400, { error: "missing idempotency key" });
        return;
      }
      const resultId = `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      json(res, 200, { idempotent: false, resultId, duplicateOperation: true });
      return;
    }

    if (method === "POST" && url.pathname === "/api/idempotent") {
      const key = String(req.headers["idempotency-key"] ?? "");
      const body = await readBody(req);
      if (!key) {
        json(res, 400, { error: "missing idempotency key" });
        return;
      }
      const existing = state.idempotency.get(key);
      if (existing) {
        json(res, 200, { idempotent: true, sameResult: true, resultId: existing });
        return;
      }
      const resultId = `result-${key.slice(0, 8)}`;
      state.idempotency.set(key, resultId);
      json(res, 200, { idempotent: false, resultId });
      return;
    }

    if (method === "POST" && url.pathname === "/api/users") {
      const body = JSON.parse(await readBody(req));
      const protectMassAssignment = process.env.SEQURAI_LAB_MASS_ASSIGNMENT_PROTECTED === "1";
      if (protectMassAssignment && body.role === "admin") {
        json(res, 403, { error: "forbidden", role: "user", privilegedFieldAccepted: false });
        return;
      }
      if (body.role === "admin") {
        json(res, 200, { id: "user-probe", role: "admin", privilegedFieldAccepted: true });
        return;
      }
      json(res, 200, { id: "user-probe", role: "user", privilegedFieldAccepted: false });
      return;
    }

    if (method === "GET" && url.pathname === "/api/admin/stats") {
      const allowEscalation = process.env.SEQURAI_LAB_PRIVILEGE_ESCALATION_VULNERABLE === "1";
      if (allowEscalation || auth === "test-token-admin") {
        json(res, 200, { admin: true, stats: { users: 1 }, privileged: true });
        return;
      }
      json(res, 403, { error: "admin access denied" });
      return;
    }

    if (method === "GET" && url.pathname === "/api/echo") {
      const query = url.searchParams.get("q") ?? "";
      const protectInjection = process.env.SEQURAI_LAB_INJECTION_PROTECTED === "1";
      if (protectInjection) {
        json(res, 200, { echo: "[sanitized]", sanitized: true, payloadReflected: false });
        return;
      }
      json(res, 200, { echo: query });
      return;
    }

    if (method === "GET" && url.pathname === "/api/outbound-fetch") {
      const target = url.searchParams.get("url");
      if (!target) {
        json(res, 400, { error: "missing url" });
        return;
      }
      const allowSsrfCanary = process.env.SEQURAI_LAB_SSRF_VULNERABLE === "1";
      if (allowSsrfCanary && target === "http://127.0.0.1:9/probe") {
        json(res, 200, { fetched: target, internalFetch: true });
        return;
      }
      if (/127\.0\.0\.1|169\.254\.169\.254|metadata/i.test(target)) {
        json(res, 400, { error: "internal/metadata URLs blocked", internalFetch: false });
        return;
      }
      json(res, 200, { fetched: target, internalFetch: true });
      return;
    }

    if (method === "GET" && url.pathname === "/secure-headers") {
      json(
        res,
        200,
        { ok: true },
        {
          "content-security-policy": "default-src 'self'",
          "strict-transport-security": "max-age=31536000",
          "x-content-type-options": "nosniff",
        }
      );
      return;
    }

    if (method === "GET" && url.pathname === "/") {
      json(res, 200, { ok: true, lab: "dynamic-security-lab" });
      return;
    }

    json(res, 404, { error: "not_found", path: url.pathname });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve dynamic security lab port");
  }

  return {
    server,
    port: address.port,
    origin: `http://127.0.0.1:${address.port}`,
    resetState: () => {
      state.idempotency.clear();
      state.rateLimitCounter = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
