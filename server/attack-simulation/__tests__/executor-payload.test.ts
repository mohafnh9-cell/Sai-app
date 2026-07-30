import { describe, expect, it } from "vitest";
import {
  attackExecutionIdempotencyKey,
  buildAttackExecutionRunPayload,
  parseAttackExecutionRunInngestEvent,
} from "../executor/inngest-payload";

describe("attack execution inngest payload", () => {
  const payload = {
    organizationId: "66666666-6666-4666-8666-666666666666",
    projectId: "55555555-5555-4555-8555-555555555555",
    campaignId: "11111111-1111-4111-8111-111111111111",
    executionId: "22222222-2222-4222-8222-222222222222",
    correlationId: "33333333-3333-4333-8333-333333333333",
    targetUrl: null,
  };

  it("round-trips a valid payload", () => {
    const built = buildAttackExecutionRunPayload(payload);
    const parsed = parseAttackExecutionRunInngestEvent(built);
    expect(parsed.executionId).toBe(payload.executionId);
  });

  it("builds stable idempotency keys", () => {
    expect(
      attackExecutionIdempotencyKey({
        organizationId: payload.organizationId,
        executionId: payload.executionId,
      })
    ).toBe(`${payload.organizationId}:${payload.executionId}`);
  });

  it("rejects invalid payloads", () => {
    expect(() => parseAttackExecutionRunInngestEvent({ executionId: "bad" })).toThrow();
  });
});
