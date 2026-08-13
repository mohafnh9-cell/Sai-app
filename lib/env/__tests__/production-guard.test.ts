import { describe, expect, it, afterEach, vi } from "vitest";
import {
  assertProductionSafe,
  isAuthBypassAllowed,
  isBypassFlagSet,
} from "@/lib/env/production-guard";
import { validateEnvironment } from "@/lib/env/validate-env";

describe("production guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects bypass flag", () => {
    vi.stubEnv("SEQURAI_BYPASS_AUTH", "true");
    expect(isBypassFlagSet()).toBe(true);
  });

  it("throws when bypass is enabled in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SEQURAI_BYPASS_AUTH", "true");
    expect(() => assertProductionSafe()).toThrow(/SEQURAI_BYPASS_AUTH/);
  });

  it("throws when bypass is enabled in production via isAuthBypassAllowed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SEQURAI_BYPASS_AUTH", "1");
    expect(() => isAuthBypassAllowed()).toThrow(/SEQURAI_BYPASS_AUTH/);
  });

  it("throws when skip target verification is enabled in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SEQURAI_SKIP_TARGET_VERIFICATION", "true");
    expect(() => assertProductionSafe()).toThrow(/SEQURAI_SKIP_TARGET_VERIFICATION/);
  });

  it("allows bypass only in non-production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SEQURAI_BYPASS_AUTH", "true");
    expect(isAuthBypassAllowed()).toBe(true);
  });
});

describe("validateEnvironment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires webhook secret in production mode", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.sequrai.com");

    const result = validateEnvironment({ production: true });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("GITHUB_WEBHOOK_SECRET"))).toBe(true);
  });

  it("rejects bypass in production", () => {
    vi.stubEnv("SEQURAI_BYPASS_AUTH", "true");
    const result = validateEnvironment({ production: true });
    expect(result.errors.some((e) => e.includes("SEQURAI_BYPASS_AUTH"))).toBe(true);
  });
});
