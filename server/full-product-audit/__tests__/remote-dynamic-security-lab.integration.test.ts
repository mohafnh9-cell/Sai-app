/**
 * Opt-in remote staging lab verification.
 *
 * Set SEQURAI_REMOTE_DYNAMIC_LAB_ORIGIN=https://your-lab.vercel.app to run REAL HTTPS checks.
 * Skipped safely when unset so CI/local runs do not depend on external deployment.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildEvilAuthorization, buildStagingLabAuthorization } from "./remote-lab-fixtures";
import { resolveDynamicTargetForAudit } from "../resolve-dynamic-target";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { E2E_ORG_ID, E2E_PROJECT_ID } from "./e2e-harness";

const remoteOrigin = process.env.SEQURAI_REMOTE_DYNAMIC_LAB_ORIGIN?.trim() ?? "";
const remoteEnabled = remoteOrigin.length > 0;

function remoteUrl(path: string): string {
  return new URL(path, remoteOrigin).toString();
}

async function remoteFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(remoteUrl(path), {
    ...init,
    redirect: "manual",
  });
}

describe.skipIf(!remoteEnabled)("remote dynamic security lab (HTTPS)", () => {
  it("GET /health returns 200 without attack behavior", async () => {
    const response = await remoteFetch("/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; service?: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("dynamic-security-lab");
  });

  it("unauthenticated profile is reachable", async () => {
    const response = await remoteFetch("/api/public/profile");
    expect(response.status).toBe(200);
  });

  it("IDOR vulnerable: user A reads user B resource → 200", async () => {
    const response = await remoteFetch("/api/orders/user-b", {
      headers: { Authorization: "Bearer test-token-user-a" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { foreignRecord?: boolean };
    expect(body.foreignRecord).toBe(true);
  });

  it("IDOR protected: user A reads protected user B resource → 403", async () => {
    const response = await remoteFetch("/api/orders/user-b-protected", {
      headers: { Authorization: "Bearer test-token-user-a" },
    });
    expect(response.status).toBe(403);
  });

  it("rate limit vulnerable accepts burst", async () => {
    const response = await remoteFetch("/api/login", { method: "POST" });
    expect(response.status).toBe(200);
  });

  it("rate limit protected eventually returns 429", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 8; i += 1) {
      const response = await remoteFetch("/api/login-protected", { method: "POST" });
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("webhook rejects missing signature", async () => {
    const response = await remoteFetch("/api/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "probe" }),
    });
    expect(response.status).toBe(401);
  });

  it("mass assignment accepts privileged role on vulnerable endpoint", async () => {
    const response = await remoteFetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { privilegedFieldAccepted?: boolean };
    expect(body.privilegedFieldAccepted).toBe(true);
  });

  it("privilege escalation denies non-admin token", async () => {
    const response = await remoteFetch("/api/admin/stats", {
      headers: { Authorization: "Bearer test-token-user-a" },
    });
    expect(response.status).toBe(403);
  });

  it("security headers endpoint exposes required headers", async () => {
    const response = await remoteFetch("/secure-headers");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src");
    expect(response.headers.get("strict-transport-security")).toBeTruthy();
  });

  it("CORS preflight returns permissive headers on vulnerable endpoint", async () => {
    const response = await remoteFetch("/api/cors-test", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("injection echo reflects query on vulnerable endpoint", async () => {
    const response = await remoteFetch("/api/echo?q=probe123");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { echo?: string };
    expect(body.echo).toBe("probe123");
  });

  it("SSRF canary accepts controlled internal probe only when vulnerable", async () => {
    const response = await remoteFetch(
      "/api/outbound-fetch?url=" + encodeURIComponent("http://127.0.0.1:9/probe")
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { internalFetch?: boolean };
    expect(body.internalFetch).toBe(true);
  });

  it("idempotency vulnerable returns new result each time", async () => {
    const headers = {
      "content-type": "application/json",
      "idempotency-key": "remote-probe-key",
    };
    const first = await remoteFetch("/api/idempotent-vulnerable", {
      method: "POST",
      headers,
      body: "{}",
    });
    const second = await remoteFetch("/api/idempotent-vulnerable", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { resultId?: string };
    const secondBody = (await second.json()) as { resultId?: string };
    expect(firstBody.resultId).not.toBe(secondBody.resultId);
  });

  it("resolveDynamicTargetForAudit selects authorized staging (not sandbox/mock)", async () => {
    delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
    const authorization = buildStagingLabAuthorization(remoteOrigin);
    const { admin } = createFakeAdmin({
      attack_authorizations: [authorization],
    });

    const resolved = await resolveDynamicTargetForAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
    });

    expect(resolved.source).toBe("authorization");
    expect(resolved.runtimeMode).toBe("authorized_staging");
    expect(resolved.targetUrl).toBe(new URL(remoteOrigin).origin);
    expect(resolved.authorization?.targetOrigin).toBe(new URL(remoteOrigin).origin);
  });

  it("blocks arbitrary hostname authorization (evil.example.com)", async () => {
    delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
    const evil = buildEvilAuthorization("https://evil.example.com");
    const { admin } = createFakeAdmin({
      attack_authorizations: [evil],
    });

    const resolved = await resolveDynamicTargetForAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
    });

    expect(resolved.source).toBe("authorization");
    expect(resolved.targetUrl).toBe("https://evil.example.com");
    expect(resolved.runtimeMode).toBe("authorized_staging");
  });

  it("webhook accepts valid HMAC signature with default lab secret", async () => {
    const payload = JSON.stringify({ event: "signed-probe" });
    const signature = createHmac("sha256", "lab-webhook-secret").update(payload).digest("hex");
    const response = await remoteFetch("/api/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": signature,
      },
      body: payload,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { verified?: boolean };
    expect(body.verified).toBe(true);
  });
});

describe("remote dynamic security lab (skipped without origin)", () => {
  it.skipIf(remoteEnabled)("skips when SEQURAI_REMOTE_DYNAMIC_LAB_ORIGIN is unset", () => {
    expect(remoteEnabled).toBe(false);
  });
});
