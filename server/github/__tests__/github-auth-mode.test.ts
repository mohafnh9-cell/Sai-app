import { describe, expect, it } from "vitest";
import {
  GITHUB_APP_TARGET_PERMISSIONS,
  isLegacyOAuthMode,
} from "@/server/github/github-auth-mode";

describe("GitHub App migration architecture", () => {
  it("defaults to legacy OAuth mode", () => {
    expect(isLegacyOAuthMode(undefined)).toBe(true);
    expect(isLegacyOAuthMode("oauth_legacy")).toBe(true);
    expect(isLegacyOAuthMode("github_app")).toBe(false);
  });

  it("defines least-privilege target permissions", () => {
    expect(GITHUB_APP_TARGET_PERMISSIONS.contents).toBe("read");
    expect(GITHUB_APP_TARGET_PERMISSIONS.pull_requests).toBe("read");
    expect(GITHUB_APP_TARGET_PERMISSIONS.checks).toBe("write");
  });
});
