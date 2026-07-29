import { describe, expect, it, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  INTERNAL_OPS_AUTH_HEADER,
  assertInternalOpsAuthorized,
  verifyInternalOpsRequest,
} from "@/lib/auth/internal-ops";
import { updateSession } from "@/lib/supabase/middleware";

describe("internal-ops auth", () => {
  const backup = { ...process.env };

  afterEach(() => {
    process.env = { ...backup };
  });

  it("rejects requests without a token when INTERNAL_OPS_TOKEN is set", () => {
    process.env.INTERNAL_OPS_TOKEN = "secret-ops-token";
    const request = new Request("https://app.example.com/api/internal/metrics");
    expect(verifyInternalOpsRequest(request)).toBe(false);
    const response = assertInternalOpsAuthorized(request);
    expect(response?.status).toBe(401);
  });

  it("accepts a matching ops token", () => {
    process.env.INTERNAL_OPS_TOKEN = "secret-ops-token";
    const request = new Request("https://app.example.com/api/internal/metrics", {
      headers: { [INTERNAL_OPS_AUTH_HEADER]: "secret-ops-token" },
    });
    expect(verifyInternalOpsRequest(request)).toBe(true);
    expect(assertInternalOpsAuthorized(request)).toBeNull();
  });

  it("rejects wrong token without treating missing config as open", () => {
    process.env.INTERNAL_OPS_TOKEN = "secret-ops-token";
    const request = new Request("https://app.example.com/api/internal/metrics", {
      headers: { [INTERNAL_OPS_AUTH_HEADER]: "wrong" },
    });
    expect(verifyInternalOpsRequest(request)).toBe(false);
  });

  it("rejects all requests when INTERNAL_OPS_TOKEN is unset", () => {
    delete process.env.INTERNAL_OPS_TOKEN;
    const request = new Request("https://app.example.com/api/internal/metrics", {
      headers: { [INTERNAL_OPS_AUTH_HEADER]: "anything" },
    });
    expect(verifyInternalOpsRequest(request)).toBe(false);
  });
});

describe("middleware internal routes", () => {
  const backup = { ...process.env };

  afterEach(() => {
    process.env = { ...backup };
  });

  it("returns 401 for /api/internal without ops token before session handling", async () => {
    process.env.INTERNAL_OPS_TOKEN = "ops";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const request = new NextRequest("https://app.example.com/api/internal/jobs/health");
    const response = await updateSession(request);
    expect(response.status).toBe(401);
  });
});
