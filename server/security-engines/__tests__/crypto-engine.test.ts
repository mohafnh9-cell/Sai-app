import { describe, expect, it } from "vitest";
import { createCryptoEngine } from "../crypto/engine";
import { runCryptoRules } from "../crypto/rules";

describe("CryptoEngine -- true positives (section 14/16)", () => {
  it("flags MD5 used to hash a password", () => {
    const matches = runCryptoRules([
      {
        path: "auth/hash-password.ts",
        content: `import { createHash } from "crypto";
function hashPassword(password: string) {
  return createHash("md5").update(password).digest("hex");
}`,
      },
    ]);
    expect(matches.some((m) => m.ruleId === "crypto.weak-hash-password")).toBe(true);
  });

  it("flags AES-ECB mode", () => {
    const matches = runCryptoRules([
      { path: "lib/encrypt.ts", content: `const cipher = createCipheriv("aes-256-ecb", key, null);` },
    ]);
    expect(matches.some((m) => m.ruleId === "crypto.aes-ecb-mode")).toBe(true);
  });

  it("flags a hardcoded encryption key", () => {
    const matches = runCryptoRules([
      { path: "lib/crypto-config.ts", content: `const encryptionKey = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";` },
    ]);
    expect(matches.some((m) => m.ruleId === "crypto.hardcoded-key-or-iv")).toBe(true);
  });

  it("flags Math.random() used for a session token", () => {
    const matches = runCryptoRules([
      { path: "auth/session.ts", content: `const sessionToken = Math.random().toString(36).slice(2);` },
    ]);
    expect(matches.some((m) => m.ruleId === "crypto.insecure-random-token")).toBe(true);
  });

  it("flags JWT verification allowing the 'none' algorithm", () => {
    const matches = runCryptoRules([
      { path: "auth/jwt.ts", content: `jwt.verify(token, secret, { algorithms: ["none", "HS256"] });` },
    ]);
    expect(matches.some((m) => m.ruleId === "crypto.jwt-none-algorithm")).toBe(true);
  });

  it("flags disabled TLS certificate verification", () => {
    const matches = runCryptoRules([
      { path: "lib/http-client.ts", content: `const agent = new https.Agent({ rejectUnauthorized: false });` },
    ]);
    expect(matches.some((m) => m.ruleId === "crypto.tls-verification-disabled")).toBe(true);
  });
});

describe("CryptoEngine -- false-positive suppression (section 15/31)", () => {
  it("does NOT flag MD5 used for a cache key (no security context nearby)", () => {
    const matches = runCryptoRules([
      {
        path: "lib/cache.ts",
        content: `import { createHash } from "crypto";
// Build a stable cache key for this asset's fingerprint.
function cacheKey(assetPath: string) {
  return createHash("md5").update(assetPath).digest("hex");
}`,
      },
    ]);
    expect(matches.some((m) => m.ruleId === "crypto.weak-hash-password")).toBe(false);
  });

  it("does NOT flag Math.random() used for harmless UI randomization", () => {
    const matches = runCryptoRules([
      {
        path: "components/ConfettiAnimation.tsx",
        content: `// Randomize confetti particle color for visual variety.
const hue = Math.random() * 360;`,
      },
    ]);
    expect(matches.some((m) => m.ruleId === "crypto.insecure-random-token")).toBe(false);
  });

  it("does NOT flag a key loaded from an environment variable as hardcoded", () => {
    const matches = runCryptoRules([
      { path: "lib/crypto-config.ts", content: `const encryptionKey = process.env.ENCRYPTION_KEY;` },
    ]);
    expect(matches.some((m) => m.ruleId === "crypto.hardcoded-key-or-iv")).toBe(false);
  });
});

describe("CryptoEngine -- SecurityEngine contract", () => {
  it("is applicable to a repo with source files and produces a COMPLETED result with canonical findings", async () => {
    const engine = createCryptoEngine();
    expect(engine.applicability({ files: [{ path: "app.ts" }] }).applicable).toBe(true);

    const result = await engine.execute({
      scanId: "scan-1",
      projectId: "project-1",
      organizationId: "org-1",
      files: [{ path: "auth/session.ts", content: `const t = Math.random().toString(36); // session token` }],
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.engine).toBe("crypto");
    expect(result.findings[0]?.exploitability.level).not.toBe("CRITICAL"); // static-only, never auto-CRITICAL
    expect(result.findings[0]?.verificationStatus).toBe("POTENTIAL");
  });

  it("is a no-op, never FAILED, for a repo with no source files", async () => {
    const engine = createCryptoEngine();
    const result = await engine.execute({
      scanId: "scan-2",
      projectId: "project-1",
      organizationId: "org-1",
      files: [{ path: "README.md", content: "# hello" }],
      timeoutMs: 5_000,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.findings).toHaveLength(0);
  });
});
