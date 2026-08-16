import { describe, expect, it } from "vitest";
import {
  computeS256Challenge,
  generateCodeVerifier,
  validatePkceMethod,
  verifyPkce,
} from "@/server/mcp/oauth/pkce";
import { OAuthError } from "@/server/mcp/oauth/errors";

describe("PKCE S256", () => {
  it("generates and verifies a valid S256 challenge", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeS256Challenge(verifier);
    expect(() => verifyPkce(verifier, challenge, "S256")).not.toThrow();
  });

  it("rejects invalid verifier", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeS256Challenge(verifier);
    expect(() => verifyPkce(`${verifier}x`, challenge, "S256")).toThrow(OAuthError);
  });

  it("rejects missing challenge method", () => {
    expect(() => validatePkceMethod(undefined)).toThrow(OAuthError);
  });

  it("rejects plain method", () => {
    expect(() => validatePkceMethod("plain")).toThrow(OAuthError);
  });

  it("rejects downgrade from S256 to plain on verify", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeS256Challenge(verifier);
    expect(() => verifyPkce(verifier, challenge, "plain")).toThrow(OAuthError);
  });
});
