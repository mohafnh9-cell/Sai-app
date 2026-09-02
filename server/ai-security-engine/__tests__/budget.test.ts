import { afterEach, describe, expect, it, vi } from "vitest";

function adminMockWithRows(rows: Array<{ tokens_used: number }>, queryError: unknown = null) {
  const eqCalls: unknown[][] = [];
  return {
    from: () => ({
      select: () => ({
        eq: (...args: unknown[]) => {
          eqCalls.push(args);
          return {
            gte: () => Promise.resolve({ data: queryError ? null : rows, error: queryError }),
          };
        },
      }),
    }),
    eqCalls,
  };
}

describe("assertAiBudgetAvailable — M2", () => {
  const backup = { ...process.env };

  afterEach(() => {
    process.env = { ...backup };
    vi.resetModules();
  });

  it("does nothing when cost control is disabled (default outside production)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    const { assertAiBudgetAvailable } = await import("../budget");
    const admin = adminMockWithRows([{ tokens_used: 999_999_999 }]);

    await expect(assertAiBudgetAvailable(admin as never, "org-1")).resolves.toBeUndefined();
  });

  it("throws AiBudgetExceededError when today's call count is at or over the limit", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.AI_CALLS_PER_ORGANIZATION_PER_DAY = "3";
    process.env.AI_TOKEN_BUDGET_PER_ORGANIZATION_PER_DAY = "1000000";
    const { assertAiBudgetAvailable, AiBudgetExceededError } = await import("../budget");
    const admin = adminMockWithRows([
      { tokens_used: 100 },
      { tokens_used: 100 },
      { tokens_used: 100 },
    ]);

    const error = await assertAiBudgetAvailable(admin as never, "org-1").catch((e) => e);
    expect(error).toBeInstanceOf(AiBudgetExceededError);
    expect((error as InstanceType<typeof AiBudgetExceededError>).reason).toBe("calls");
  });

  it("throws AiBudgetExceededError when today's summed token usage is at or over the limit", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.AI_CALLS_PER_ORGANIZATION_PER_DAY = "1000";
    process.env.AI_TOKEN_BUDGET_PER_ORGANIZATION_PER_DAY = "1000";
    const { assertAiBudgetAvailable, AiBudgetExceededError } = await import("../budget");
    const admin = adminMockWithRows([{ tokens_used: 600 }, { tokens_used: 500 }]);

    const error = await assertAiBudgetAvailable(admin as never, "org-1").catch((e) => e);
    expect(error).toBeInstanceOf(AiBudgetExceededError);
    expect((error as InstanceType<typeof AiBudgetExceededError>).reason).toBe("tokens");
  });

  it("allows the call through when comfortably under both limits", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.AI_CALLS_PER_ORGANIZATION_PER_DAY = "200";
    process.env.AI_TOKEN_BUDGET_PER_ORGANIZATION_PER_DAY = "2000000";
    const { assertAiBudgetAvailable } = await import("../budget");
    const admin = adminMockWithRows([{ tokens_used: 1000 }]);

    await expect(assertAiBudgetAvailable(admin as never, "org-1")).resolves.toBeUndefined();
  });

  it("fails open (does not throw) when the usage query itself errors", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.AI_CALLS_PER_ORGANIZATION_PER_DAY = "1";
    const { assertAiBudgetAvailable } = await import("../budget");
    const admin = adminMockWithRows([], { message: "relation does not exist" });

    await expect(assertAiBudgetAvailable(admin as never, "org-1")).resolves.toBeUndefined();
  });

  it("scopes the usage query to the given organization", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    const { assertAiBudgetAvailable } = await import("../budget");
    const admin = adminMockWithRows([]);

    await assertAiBudgetAvailable(admin as never, "org-specific");
    expect(admin.eqCalls).toContainEqual(["organization_id", "org-specific"]);
  });
});
