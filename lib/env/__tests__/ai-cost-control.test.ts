import { afterEach, describe, expect, it } from "vitest";
import {
  isAiCostControlDisabled,
  aiCallsPerOrganizationPerDayLimit,
  aiTokenBudgetPerOrganizationPerDayLimit,
} from "@/lib/env/ai-cost-control";

describe("AI cost control env — M2", () => {
  const backup = { ...process.env };

  afterEach(() => {
    process.env = { ...backup };
  });

  it("disables limits when AI_COST_CONTROL_DISABLED is set", () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.AI_COST_CONTROL_DISABLED = "1";
    expect(isAiCostControlDisabled()).toBe(true);
    expect(aiCallsPerOrganizationPerDayLimit()).toBeNull();
    expect(aiTokenBudgetPerOrganizationPerDayLimit()).toBeNull();
  });

  it("disables limits outside production without an explicit opt-in", () => {
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    delete process.env.AI_COST_CONTROL_DISABLED;
    delete process.env.AI_COST_CONTROL_ENABLED;
    expect(isAiCostControlDisabled()).toBe(true);
  });

  it("enables limits in production by default with sane defaults", () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    delete process.env.AI_COST_CONTROL_DISABLED;
    delete process.env.AI_CALLS_PER_ORGANIZATION_PER_DAY;
    delete process.env.AI_TOKEN_BUDGET_PER_ORGANIZATION_PER_DAY;
    expect(isAiCostControlDisabled()).toBe(false);
    expect(aiCallsPerOrganizationPerDayLimit()).toBe(200);
    expect(aiTokenBudgetPerOrganizationPerDayLimit()).toBe(2_000_000);
  });

  it("honors env-configured limits without hardcoding provider pricing anywhere", () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.AI_CALLS_PER_ORGANIZATION_PER_DAY = "50";
    process.env.AI_TOKEN_BUDGET_PER_ORGANIZATION_PER_DAY = "500000";
    expect(aiCallsPerOrganizationPerDayLimit()).toBe(50);
    expect(aiTokenBudgetPerOrganizationPerDayLimit()).toBe(500_000);
  });

  it("ignores non-positive or non-numeric overrides and falls back to defaults", () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.AI_CALLS_PER_ORGANIZATION_PER_DAY = "-5";
    expect(aiCallsPerOrganizationPerDayLimit()).toBe(200);
  });

  it("lets a dev opt in explicitly outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    process.env.AI_COST_CONTROL_ENABLED = "1";
    expect(isAiCostControlDisabled()).toBe(false);
  });
});
