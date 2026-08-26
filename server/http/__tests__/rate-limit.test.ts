import { describe, expect, it } from "vitest";
import { enforceRateLimit, resetRateLimitStateForTests } from "../rate-limit";

describe("enforceRateLimit", () => {
  it("returns 429 after the configured limit is exceeded", async () => {
    resetRateLimitStateForTests();
    const request = new Request("https://example.com/api/projects", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });

    expect(await enforceRateLimit(request, { limit: 2, windowMs: 60_000, keyPrefix: "test" })).toBeNull();
    expect(await enforceRateLimit(request, { limit: 2, windowMs: 60_000, keyPrefix: "test" })).toBeNull();
    const blocked = await enforceRateLimit(request, {
      limit: 2,
      windowMs: 60_000,
      keyPrefix: "test",
    });

    expect(blocked?.status).toBe(429);
  });

  it("returns a typed rate_limited error body when errorCode/errorMessage are provided (MCP contract)", async () => {
    resetRateLimitStateForTests();
    const request = new Request("https://example.com/api/mcp", {
      headers: { "x-forwarded-for": "203.0.113.20" },
    });
    const options = {
      limit: 1,
      windowMs: 60_000,
      keyPrefix: "mcp-test",
      errorCode: "rate_limited",
      errorMessage: "Too many requests. Wait a moment before trying again.",
    };

    expect(await enforceRateLimit(request, options)).toBeNull();
    const blocked = await enforceRateLimit(request, options);

    expect(blocked?.status).toBe(429);
    const body = await blocked?.json();
    expect(body).toMatchObject({
      code: "rate_limited",
      error: "Too many requests. Wait a moment before trying again.",
    });
  });
});
