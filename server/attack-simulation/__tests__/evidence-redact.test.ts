import { describe, expect, it } from "vitest";
import {
  redactAttackJson,
  redactAttackSecrets,
  redactAttackUrl,
} from "../evidence/redact";

describe("attack evidence redaction", () => {
  it("redacts bearer tokens and api keys in strings", () => {
    const input = 'Authorization: Bearer abc.def.ghi api_key="super-secret-key-12345"';
    const out = redactAttackSecrets(input);
    expect(out).not.toContain("abc.def.ghi");
    expect(out).not.toContain("super-secret-key-12345");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts sensitive query params in urls", () => {
    const out = redactAttackUrl("https://staging.example.com/callback?token=secret-value&page=1");
    expect(out).toContain("token=%5BREDACTED%5D");
    expect(out).toContain("page=1");
    expect(out).not.toContain("secret-value");
  });

  it("redacts nested json secrets by key", () => {
    const out = redactAttackJson({
      user: "alice",
      password: "hunter2",
      nested: { token: "abc123" },
    }) as Record<string, unknown>;
    expect(out.user).toBe("alice");
    expect(out.password).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).token).toBe("[REDACTED]");
  });
});
