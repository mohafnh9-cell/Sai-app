import { describe, expect, it, beforeEach } from "vitest";
import { handleDynamicSecurityLabRequest, resetLabState } from "../handler";

describe("dynamic security lab handler", () => {
  beforeEach(() => {
    resetLabState();
    delete process.env.SEQURAI_LAB_IDOR_PROTECTED;
    delete process.env.SEQURAI_LAB_WEBHOOK_UNPROTECTED;
  });

  it("GET /health returns non-sensitive 200", async () => {
    const response = await handleDynamicSecurityLabRequest({
      method: "GET",
      pathname: "/health",
      searchParams: new URLSearchParams(),
      headers: {},
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      service: "dynamic-security-lab",
      synthetic: true,
    });
  });

  it("preserves IDOR vulnerable semantics", async () => {
    const response = await handleDynamicSecurityLabRequest({
      method: "GET",
      pathname: "/api/orders/user-b",
      searchParams: new URLSearchParams(),
      headers: { authorization: "Bearer test-token-user-a" },
    });
    expect(response.status).toBe(200);
  });

  it("preserves IDOR protected semantics", async () => {
    const response = await handleDynamicSecurityLabRequest({
      method: "GET",
      pathname: "/api/orders/user-b-protected",
      searchParams: new URLSearchParams(),
      headers: { authorization: "Bearer test-token-user-a" },
    });
    expect(response.status).toBe(403);
  });
});
