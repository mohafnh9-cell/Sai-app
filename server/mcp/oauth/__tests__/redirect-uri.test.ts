import { describe, expect, it } from "vitest";
import {
  assertRedirectUriAllowed,
  normalizeRegisteredRedirectUri,
  redirectUriExactMatch,
} from "@/server/mcp/oauth/redirect-uri";
import { OAuthError } from "@/server/mcp/oauth/errors";

const REGISTERED = [
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "http://127.0.0.1:6274/oauth/callback",
  "http://localhost:6274/oauth/callback",
];

describe("redirect URI validation", () => {
  it("accepts exact match", () => {
    expect(redirectUriExactMatch("http://127.0.0.1:6274/oauth/callback", REGISTERED)).toBe(true);
  });

  it("rejects host mismatch", () => {
    expect(redirectUriExactMatch("http://127.0.0.2:6274/oauth/callback", REGISTERED)).toBe(false);
  });

  it("rejects subdomain mismatch", () => {
    expect(
      redirectUriExactMatch("https://evil.chatgpt.com/connector_platform_oauth_redirect", REGISTERED)
    ).toBe(false);
  });

  it("rejects port mismatch", () => {
    expect(redirectUriExactMatch("http://127.0.0.1:6275/oauth/callback", REGISTERED)).toBe(false);
  });

  it("rejects path mismatch", () => {
    expect(redirectUriExactMatch("http://127.0.0.1:6274/oauth/evil", REGISTERED)).toBe(false);
  });

  it("rejects scheme mismatch", () => {
    expect(redirectUriExactMatch("https://127.0.0.1:6274/oauth/callback", REGISTERED)).toBe(false);
  });

  it("rejects open redirect javascript scheme", () => {
    expect(normalizeRegisteredRedirectUri("javascript:alert(1)")).toBeNull();
  });

  it("rejects path traversal in encoded form", () => {
    expect(
      redirectUriExactMatch("http://127.0.0.1:6274/oauth/callback/../admin", REGISTERED)
    ).toBe(false);
  });

  it("allows localhost http exception", () => {
    expect(normalizeRegisteredRedirectUri("http://localhost:6274/oauth/callback")).toBe(
      "http://localhost:6274/oauth/callback"
    );
  });

  it("throws invalid_redirect_uri for unregistered URI", () => {
    expect(() => assertRedirectUriAllowed("https://evil.example/cb", REGISTERED)).toThrow(
      OAuthError
    );
  });
});
