import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import {
  countRecentDynamicTargetVerifications,
  DYNAMIC_TARGET_VERIFICATIONS_PER_ORGANIZATION_PER_HOUR,
  isDynamicTargetAuthorizationRateLimited,
} from "../rate-limit";

/**
 * Phase 34 P0: authorize_dynamic_target previously had no rate limiting at
 * all (Phase 33 pentesting audit finding). Mirrors the pattern already
 * proven for server/review-now/rate-limit.ts.
 */

const ORG_A = "org-a";
const ORG_B = "org-b";

function verificationRow(organizationId: string, ageMs: number) {
  return {
    id: `verif-${Math.random()}`,
    organization_id: organizationId,
    created_at: new Date(Date.now() - ageMs).toISOString(),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Phase 34 -- isDynamicTargetAuthorizationRateLimited", () => {
  it("is not limited below the threshold", async () => {
    vi.stubEnv("SCAN_RATE_LIMIT_ENABLED", "1");
    vi.stubEnv("NODE_ENV", "production");
    const tables: FakeTables = {
      dynamic_target_verifications: Array.from({ length: 5 }, () => verificationRow(ORG_A, 60_000)),
    };
    const admin = createFakeAdmin(tables);
    expect(await isDynamicTargetAuthorizationRateLimited(admin as never, ORG_A)).toBe(false);
  });

  it("is limited once the per-organization-per-hour threshold is reached", async () => {
    vi.stubEnv("SCAN_RATE_LIMIT_ENABLED", "1");
    vi.stubEnv("NODE_ENV", "production");
    const rows = Array.from({ length: DYNAMIC_TARGET_VERIFICATIONS_PER_ORGANIZATION_PER_HOUR }, () =>
      verificationRow(ORG_A, 60_000)
    );
    const tables: FakeTables = { dynamic_target_verifications: rows };
    const admin = createFakeAdmin(tables);
    expect(await isDynamicTargetAuthorizationRateLimited(admin as never, ORG_A)).toBe(true);
  });

  it("is scoped per organization -- another organization's volume never trips this one's limit", async () => {
    vi.stubEnv("SCAN_RATE_LIMIT_ENABLED", "1");
    vi.stubEnv("NODE_ENV", "production");
    const rows = Array.from(
      { length: DYNAMIC_TARGET_VERIFICATIONS_PER_ORGANIZATION_PER_HOUR + 10 },
      () => verificationRow(ORG_B, 60_000)
    );
    const tables: FakeTables = { dynamic_target_verifications: rows };
    const admin = createFakeAdmin(tables);
    expect(await isDynamicTargetAuthorizationRateLimited(admin as never, ORG_A)).toBe(false);
  });

  it("ignores verification rows older than the 1-hour window", async () => {
    vi.stubEnv("SCAN_RATE_LIMIT_ENABLED", "1");
    vi.stubEnv("NODE_ENV", "production");
    const rows = Array.from(
      { length: DYNAMIC_TARGET_VERIFICATIONS_PER_ORGANIZATION_PER_HOUR + 10 },
      () => verificationRow(ORG_A, 2 * 60 * 60 * 1000)
    );
    const tables: FakeTables = { dynamic_target_verifications: rows };
    const admin = createFakeAdmin(tables);
    const count = await countRecentDynamicTargetVerifications(admin as never, ORG_A);
    expect(count).toBe(0);
    expect(await isDynamicTargetAuthorizationRateLimited(admin as never, ORG_A)).toBe(false);
  });

  it("SCAN_RATE_LIMIT_DISABLED bypasses the limit even over threshold", async () => {
    vi.stubEnv("SCAN_RATE_LIMIT_DISABLED", "1");
    const rows = Array.from(
      { length: DYNAMIC_TARGET_VERIFICATIONS_PER_ORGANIZATION_PER_HOUR + 10 },
      () => verificationRow(ORG_A, 60_000)
    );
    const tables: FakeTables = { dynamic_target_verifications: rows };
    const admin = createFakeAdmin(tables);
    expect(await isDynamicTargetAuthorizationRateLimited(admin as never, ORG_A)).toBe(false);
  });
});
