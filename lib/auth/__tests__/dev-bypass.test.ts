import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthBypassEnabled } from "../dev-bypass";

describe("isAuthBypassEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled on any Vercel deployment even if the shared guard were misconfigured", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("SEQURAI_BYPASS_AUTH", "true");
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it("is enabled locally when explicitly flagged", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SEQURAI_BYPASS_AUTH", "true");
    expect(isAuthBypassEnabled()).toBe(true);
  });

  it("is disabled locally without the flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isAuthBypassEnabled()).toBe(false);
  });
});
