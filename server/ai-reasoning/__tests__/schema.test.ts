import { describe, expect, it } from "vitest";
import { AiReasoningResponseSchema } from "../schema";

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const VALID_ID_2 = "22222222-2222-4222-8222-222222222222";

describe("Phase 30 -- AiReasoningResponseSchema (authority boundaries)", () => {
  it("R: severity/score/verdict/isSafe/blockersCount fields on the AI response are silently dropped, never parsed through", () => {
    const malicious = {
      findings: [],
      attackChains: [],
      severity: "low",
      score: 100,
      riskScore: 0,
      blockersCount: 0,
      verdict: "ready_to_ship",
      status: "ready_to_ship",
      isSafe: true,
      safe: true,
    };
    const result = AiReasoningResponseSchema.safeParse(malicious);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("severity");
      expect(result.data).not.toHaveProperty("score");
      expect(result.data).not.toHaveProperty("riskScore");
      expect(result.data).not.toHaveProperty("blockersCount");
      expect(result.data).not.toHaveProperty("verdict");
      expect(result.data).not.toHaveProperty("status");
      expect(result.data).not.toHaveProperty("isSafe");
      expect(result.data).not.toHaveProperty("safe");
    }
  });

  it("accepts a well-formed response with a finding and a two-id attack chain", () => {
    const result = AiReasoningResponseSchema.safeParse({
      findings: [
        {
          findingId: VALID_ID,
          exploitability: "likely_exploitable",
          confidence: "medium",
          reasoning: "The route parameter flows into a query with no ownership check visible.",
          supportingFindingIds: [],
        },
      ],
      attackChains: [
        {
          findingIds: [VALID_ID, VALID_ID_2],
          severity: "high",
          confidence: "medium",
          explanation: "Finding A's output plausibly feeds finding B's input.",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("D: rejects an out-of-enum exploitability/severity value rather than coercing it", () => {
    const result = AiReasoningResponseSchema.safeParse({
      findings: [
        {
          findingId: VALID_ID,
          exploitability: "definitely-vulnerable", // not in the bounded enum
          confidence: "high",
          reasoning: "x",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid findingId", () => {
    const result = AiReasoningResponseSchema.safeParse({
      findings: [{ findingId: "does-not-exist", exploitability: "uncertain", confidence: "low", reasoning: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("a chain with fewer than 2 finding ids is rejected at the schema level", () => {
    const result = AiReasoningResponseSchema.safeParse({
      attackChains: [{ findingIds: [VALID_ID], severity: "high", confidence: "low", explanation: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("missing top-level keys default cleanly (partial response is fine)", () => {
    const result = AiReasoningResponseSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
