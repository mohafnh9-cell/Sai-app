import { describe, expect, it } from "vitest";
import {
  buildHttpVerificationInstructions,
  generateVerificationToken,
  isBlockedVerificationHostname,
  normalizeAllowedPaths,
} from "../target-verification";

describe("target verification helpers", () => {
  it("normalizes allowed paths and strips wildcards", () => {
    expect(normalizeAllowedPaths(["/api/*", "/login", "health"])).toEqual([
      "/api",
      "/login",
      "/health",
    ]);
  });

  it("blocks localhost and private network hostnames", () => {
    expect(isBlockedVerificationHostname("localhost")).toBe(true);
    expect(isBlockedVerificationHostname("127.0.0.1")).toBe(true);
    expect(isBlockedVerificationHostname("10.0.0.5")).toBe(true);
    expect(isBlockedVerificationHostname("staging.example.com")).toBe(false);
  });

  it("generates unique verification tokens per target", () => {
    const input = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      targetOrigin: "https://staging.example.com",
    };
    const first = generateVerificationToken(input);
    const second = generateVerificationToken(input);
    expect(first).toMatch(/^sequrai-verify-/);
    expect(second).toMatch(/^sequrai-verify-/);
    expect(first).not.toBe(second);
  });

  it("builds HTTP verification instructions", () => {
    const instructions = buildHttpVerificationInstructions(
      "https://staging.example.com",
      "sequrai-verify-abc"
    );
    expect(instructions.url).toBe(
      "https://staging.example.com/.well-known/sequrai-verification.txt"
    );
    expect(instructions.expectedContent).toBe("sequrai-verify-abc");
  });
});
