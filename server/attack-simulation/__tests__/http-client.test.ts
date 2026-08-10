import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import {
  authorizationForSandboxOrigin,
  createDynamicHttpClient,
} from "../dynamic/http-client";
import type { AuthorizedDynamicTarget } from "../dynamic/authorized-target";

function buildTarget(overrides: Partial<AuthorizedDynamicTarget> = {}): AuthorizedDynamicTarget {
  const origin = "http://127.0.0.1:4242";
  return {
    baseUrl: origin,
    origin,
    environment: "sandbox",
    authorized: false,
    authorization: null,
    allowedPaths: ["/api", "/"],
    pathExclusions: [],
    maxRequestBudget: 5,
    maxDurationMs: 8_000,
    attackMode: "sandbox",
    testIdentities: {},
    ...overrides,
  };
}

function stagingAuth(origin: string): AttackAuthorizationRecord {
  const now = Date.now();
  return {
    id: "77777777-7777-4777-8777-777777777777",
    organizationId: "66666666-6666-4666-8666-666666666666",
    projectId: "55555555-5555-4555-8555-555555555555",
    targetOrigin: origin,
    environmentType: "staging",
    status: "approved",
    authorizationMethod: "manual",
    approvedScope: { allowedPaths: ["/api"] },
    createdBy: null,
    approvedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    testCredentialsRef: null,
    pathExclusions: [],
    redirectAllowlist: [],
    maxRequestBudget: 10,
    maxDurationSeconds: 300,
    commitSha: null,
  };
}

describe("dynamic http client safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks redirect to unauthorized hostname without following", async () => {
    const origin = "http://127.0.0.1:4242";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: "https://evil.example.com/steal" },
      })
    );

    const client = createDynamicHttpClient({
      target: buildTarget({
        origin,
        authorization: stagingAuth(origin),
        authorized: true,
      }),
      correlationId: "corr-redirect-host",
    });

    await expect(client.request({ method: "GET", path: "/api/health" })).rejects.toThrow(
      /Redirect blocked.*hostname/i
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks redirect to path outside authorized scope", async () => {
    const origin = "http://127.0.0.1:4242";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: `${origin}/admin/secret` },
      })
    );

    const client = createDynamicHttpClient({
      target: buildTarget({
        origin,
        authorization: stagingAuth(origin),
        authorized: true,
      }),
      correlationId: "corr-redirect-path",
    });

    await expect(client.request({ method: "GET", path: "/api/health" })).rejects.toThrow(
      /outside authorized scope/i
    );
  });

  it("stops when request budget is exhausted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const client = createDynamicHttpClient({
      target: buildTarget({ maxRequestBudget: 2 }),
      correlationId: "corr-budget",
    });

    await client.request({ method: "GET", path: "/api/a" });
    await client.request({ method: "GET", path: "/api/b" });
    await expect(client.request({ method: "GET", path: "/api/c" })).rejects.toThrow(/budget exceeded/i);
    expect(client.requestsSent).toBe(2);
  });

  it("redacts sensitive headers in evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { "set-cookie": "session=super-secret" },
      })
    );

    const client = createDynamicHttpClient({
      target: buildTarget(),
      correlationId: "corr-redact",
    });

    const evidence = await client.request({
      method: "GET",
      path: "/api/public/profile",
      headers: {
        Authorization: "Bearer secret-token",
        Cookie: "session-secret",
        "X-API-Key": "secret-key",
      },
    });

    expect(JSON.stringify(evidence)).not.toContain("secret-token");
    expect(JSON.stringify(evidence)).not.toContain("session-secret");
    expect(JSON.stringify(evidence)).not.toContain("secret-key");
    expect(evidence.headers["set-cookie"]).toBe("[REDACTED]");
  });

  it("applies destructive-action checks in sandbox via synthetic authorization", async () => {
    const client = createDynamicHttpClient({
      target: buildTarget(),
      correlationId: "corr-destructive",
    });

    await expect(
      client.request({ method: "POST", path: "/api/delete-all-users", body: {} })
    ).rejects.toThrow(/destructive/i);
  });

  it("uses sandbox authorization helper with scoped paths", () => {
    const auth = authorizationForSandboxOrigin("http://127.0.0.1:4242");
    expect(auth.approvedScope.allowedPaths).toContain("/api");
    expect(auth.environmentType).toBe("local");
  });
});
