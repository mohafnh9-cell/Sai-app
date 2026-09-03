import { afterEach, describe, expect, it, vi } from "vitest";
import { isGoogleAuthEnabled } from "../google-auth-enabled";

describe("isGoogleAuthEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled by default -- the Google button must not appear until the provider is actually configured in Supabase", () => {
    vi.stubEnv("NEXT_PUBLIC_SEQURAI_GOOGLE_AUTH_ENABLED", "");
    expect(isGoogleAuthEnabled()).toBe(false);
  });

  it("is enabled only when explicitly flagged", () => {
    vi.stubEnv("NEXT_PUBLIC_SEQURAI_GOOGLE_AUTH_ENABLED", "true");
    expect(isGoogleAuthEnabled()).toBe(true);
  });

  it("treats any non-'true' value as disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_SEQURAI_GOOGLE_AUTH_ENABLED", "1");
    expect(isGoogleAuthEnabled()).toBe(false);
  });
});
