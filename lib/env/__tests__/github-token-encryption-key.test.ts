import { afterEach, describe, expect, it, vi } from "vitest";
import { validateEnvironment } from "@/lib/env/validate-env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GitHub token encryption key validation", () => {
  it("accepts an exact 32-byte standard base64 value", () => {
    vi.stubEnv(
      "GITHUB_TOKEN_ENCRYPTION_KEY",
      Buffer.alloc(32, 10).toString("base64")
    );

    const result = validateEnvironment({ production: false });

    expect(result.errors).not.toContain(
      "GITHUB_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as standard base64"
    );
  });

  it("rejects a base64url value even when it decodes to 32 bytes", () => {
    vi.stubEnv(
      "GITHUB_TOKEN_ENCRYPTION_KEY",
      Buffer.alloc(32, 255).toString("base64").replaceAll("/", "_")
    );

    const result = validateEnvironment({ production: false });

    expect(result.errors).toContain(
      "GITHUB_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as standard base64"
    );
  });
});
