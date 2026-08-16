import { describe, expect, it, vi, afterEach } from "vitest";
import { createGitHubAppJwt } from "@/server/github-app/jwt";
import { validateInstallationPermissions } from "@/server/github-app/github-api";
import { GITHUB_APP_TARGET_PERMISSIONS } from "@/server/github/github-auth-mode";

describe("createGitHubAppJwt", () => {
  it("creates a signed JWT with RS256 header", () => {
    const { generateKeyPairSync } = require("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const jwt = createGitHubAppJwt("12345", pem);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    expect(header.alg).toBe("RS256");
  });
});

describe("validateInstallationPermissions", () => {
  it("accepts the target least-privilege permission set", () => {
    const result = validateInstallationPermissions({
      contents: "read",
      metadata: "read",
      pull_requests: "read",
      statuses: "write",
      checks: "write",
      webhooks: "write",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing write permissions", () => {
    const result = validateInstallationPermissions({
      contents: "read",
      metadata: "read",
      pull_requests: "read",
      statuses: "read",
      checks: "read",
      webhooks: "read",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing.length).toBeGreaterThan(0);
    }
  });

  it("documents every target permission key", () => {
    expect(Object.keys(GITHUB_APP_TARGET_PERMISSIONS).sort()).toEqual(
      ["checks", "contents", "metadata", "pull_requests", "statuses", "webhooks"].sort()
    );
  });
});

describe("fetchInstallationAccessToken", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null when GitHub App is not configured", async () => {
    vi.unstubAllEnvs();
    const { fetchInstallationAccessToken } = await import(
      "@/server/github-app/installation-token-service"
    );
    const result = await fetchInstallationAccessToken(999);
    expect(result).toBeNull();
  });
});
