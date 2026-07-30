import { describe, expect, it } from "vitest";
import { normalizeTimestamp } from "../persistence/mappers";
import { attackCampaignSchema } from "../contracts/attack-campaign";

describe("normalizeTimestamp", () => {
  it("converts postgres space-separated timestamptz to ISO datetime", () => {
    const normalized = normalizeTimestamp("2026-07-30 14:20:00.123456+00");
    expect(attackCampaignSchema.shape.createdAt.safeParse(normalized).success).toBe(true);
  });

  it("converts Date objects to ISO datetime", () => {
    const normalized = normalizeTimestamp(new Date("2026-07-30T14:20:00.000Z"));
    expect(normalized).toBe("2026-07-30T14:20:00.000Z");
  });
});
