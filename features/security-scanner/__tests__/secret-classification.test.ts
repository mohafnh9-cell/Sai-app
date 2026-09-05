import { describe, expect, it } from "vitest";
import {
  classifySecretDetection,
  inferSecretClassificationFromPersistedFinding,
  isNonBlockingSecretClassification,
  severityForSecretClassification,
  SECRET_CLASSIFICATION_METADATA_KEY,
} from "../rules/secret-classification";

const testLines = (content: string) => content.split("\n");

describe("classifySecretDetection", () => {
  it("classifies fake token in test file as TEST_FIXTURE", () => {
    const result = classifySecretDetection({
      path: "server/auth/session.test.ts",
      value: "oauth-access-test-token",
      variableName: "accessToken",
      line: 'const accessToken = "oauth-access-test-token";',
      lineIndex: 0,
      fileLines: testLines('const accessToken = "oauth-access-test-token";'),
    });
    expect(result.classification).toBe("TEST_FIXTURE");
  });

  it("classifies fake OAuth token in test file as TEST_FIXTURE", () => {
    const content = [
      "vi.mock('@/server/oauth/client');",
      'const providerToken = "oauth-provider-test-token";',
    ].join("\n");
    const result = classifySecretDetection({
      path: "app/auth/callback/__tests__/route.test.ts",
      value: "oauth-provider-test-token",
      variableName: "providerToken",
      line: 'const providerToken = "oauth-provider-test-token";',
      lineIndex: 1,
      fileLines: testLines(content),
    });
    expect(result.classification).toBe("TEST_FIXTURE");
  });

  it("classifies placeholder values as PLACEHOLDER", () => {
    const result = classifySecretDetection({
      path: "config/example.ts",
      value: "your-secret-here",
      variableName: "API_KEY",
      line: 'const API_KEY = "your-secret-here";',
      lineIndex: 0,
      fileLines: testLines('const API_KEY = "your-secret-here";'),
    });
    expect(result.classification).toBe("PLACEHOLDER");
  });

  it("keeps GitHub token in test as REAL_SECRET", () => {
    const token = "gho_abcdefghijklmnopqrstuvwxyz123456";
    const result = classifySecretDetection({
      path: "app/auth/callback/__tests__/route.test.ts",
      value: token,
      variableName: "providerToken",
      line: `const providerToken = "${token}";`,
      lineIndex: 0,
      fileLines: testLines(`const providerToken = "${token}";`),
    });
    expect(result.classification).toBe("REAL_SECRET");
  });

  it("keeps JWT in test as REAL_SECRET", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8";
    const result = classifySecretDetection({
      path: "server/auth/session.test.ts",
      value: jwt,
      variableName: "sessionToken",
      line: `const sessionToken = "${jwt}";`,
      lineIndex: 0,
      fileLines: testLines(`const sessionToken = "${jwt}";`),
    });
    expect(result.classification).toBe("REAL_SECRET");
  });

  it("keeps private key in test as REAL_SECRET", () => {
    const result = classifySecretDetection({
      path: "server/crypto/keys.spec.ts",
      value: "-----BEGIN RSA PRIVATE KEY-----",
      variableName: "material",
      line: 'const material = "-----BEGIN RSA PRIVATE KEY-----";',
      lineIndex: 0,
      fileLines: testLines('const material = "-----BEGIN RSA PRIVATE KEY-----";'),
    });
    expect(result.classification).toBe("REAL_SECRET");
  });

  it("keeps Stripe live key in test as REAL_SECRET", () => {
    const result = classifySecretDetection({
      path: "fixtures/payments/stripe.test.ts",
      value: "sk_live_abcdefghijklmnopqrstuvwxyz",
      variableName: "apiKey",
      line: 'const apiKey = "sk_live_abcdefghijklmnopqrstuvwxyz";',
      lineIndex: 0,
      fileLines: testLines('const apiKey = "sk_live_abcdefghijklmnopqrstuvwxyz";'),
    });
    expect(result.classification).toBe("REAL_SECRET");
  });

  it("detects real secret outside tests as REAL_SECRET or POTENTIAL", () => {
    const result = classifySecretDetection({
      path: "server/config/production.ts",
      value: "hardcoded-production-key",
      variableName: "SERVICE_API_KEY",
      line: "const SERVICE_API_KEY = 'hardcoded-production-key';",
      lineIndex: 0,
      fileLines: testLines("const SERVICE_API_KEY = 'hardcoded-production-key';"),
    });
    expect(["REAL_SECRET", "PROBABLE_SECRET", "POTENTIAL_SECRET"]).toContain(result.classification);
  });

  it("uses entropy and context for probable or potential secrets", () => {
    const result = classifySecretDetection({
      path: "server/config/production.ts",
      value: "xK9mP2qR7vN4wL8hJ3sT6yU1zA5bC0dE",
      variableName: "DATABASE_PASSWORD",
      line: 'const DATABASE_PASSWORD = "xK9mP2qR7vN4wL8hJ3sT6yU1zA5bC0dE";',
      lineIndex: 0,
      fileLines: testLines(
        'const client = createClient(process.env.URL, "xK9mP2qR7vN4wL8hJ3sT6yU1zA5bC0dE");'
      ),
    });
    expect(["PROBABLE_SECRET", "POTENTIAL_SECRET", "REAL_SECRET"]).toContain(result.classification);
  });

  it("uses mixed context correctly for OAuth fixtures with mocks", () => {
    const content = [
      "describe('callback', () => {",
      "  vi.mock('@/server/oauth/client');",
      '  const refreshToken = "oauth-refresh-test-token";',
      "});",
    ].join("\n");
    const result = classifySecretDetection({
      path: "app/auth/callback/__tests__/route.test.ts",
      value: "oauth-refresh-test-token",
      variableName: "refreshToken",
      line: '  const refreshToken = "oauth-refresh-test-token";',
      lineIndex: 2,
      fileLines: testLines(content),
    });
    expect(result.classification).toBe("TEST_FIXTURE");
  });

  it("infers TEST_FIXTURE for stale persisted OAuth test assignment rows", () => {
    const result = inferSecretClassificationFromPersistedFinding({
      ruleId: "secrets.exposed",
      filePath: "app/auth/callback/__tests__/route.test.ts",
      evidence: "providerToken=[REDACTED]",
    });
    expect(result).toBe("TEST_FIXTURE");
  });

  it("does not infer TEST_FIXTURE for pattern-detected credentials in tests", () => {
    const result = inferSecretClassificationFromPersistedFinding({
      ruleId: "secrets.exposed",
      filePath: "app/auth/callback/__tests__/route.test.ts",
      evidence: "credential=[REDACTED]",
    });
    expect(result).toBeUndefined();
  });

  describe("Phase 31.1 -- real-world false positives from next-saas-starter / NodeGoat", () => {
    it("does not flag an enum member whose value echoes its own identifier (UPDATE_PASSWORD = 'UPDATE_PASSWORD')", () => {
      const result = classifySecretDetection({
        path: "lib/db/schema.ts",
        value: "UPDATE_PASSWORD",
        variableName: "UPDATE_PASSWORD",
        line: "  UPDATE_PASSWORD = 'UPDATE_PASSWORD',",
        lineIndex: 0,
        fileLines: testLines("  UPDATE_PASSWORD = 'UPDATE_PASSWORD',"),
      });
      expect(isNonBlockingSecretClassification(result.classification)).toBe(true);
    });

    it("does not flag an ordinary error message near a password-named variable ('Invalid password')", () => {
      const result = classifySecretDetection({
        path: "app/routes/session.js",
        value: "Invalid password",
        variableName: "invalidPasswordErrorMessage",
        line: 'const invalidPasswordErrorMessage = "Invalid password";',
        lineIndex: 0,
        fileLines: testLines('const invalidPasswordErrorMessage = "Invalid password";'),
      });
      expect(isNonBlockingSecretClassification(result.classification)).toBe(true);
    });

    it("still flags a genuinely credential-shaped value in production source (identifier + value evidence together)", () => {
      const result = classifySecretDetection({
        path: "server/config/production.ts",
        value: "aK9pQ2rT7vN4wL8hJ3sT6yU1zA5bC0dE",
        variableName: "apiSecretKey",
        line: 'const apiSecretKey = "aK9pQ2rT7vN4wL8hJ3sT6yU1zA5bC0dE";',
        lineIndex: 0,
        fileLines: testLines('const apiSecretKey = "aK9pQ2rT7vN4wL8hJ3sT6yU1zA5bC0dE";'),
      });
      expect(isNonBlockingSecretClassification(result.classification)).toBe(false);
    });

    it("downgrades a credential-shaped value inside a test/ path to non-blocking (TEST_FIXTURE), reaching severity via isNonBlockingSecretClassification", () => {
      const result = classifySecretDetection({
        path: "test/security/profile-test.js",
        value: "User1_123",
        variableName: "sutUserPassword",
        line: 'var sutUserPassword = "User1_123";',
        lineIndex: 0,
        fileLines: testLines('var sutUserPassword = "User1_123";'),
      });
      expect(result.classification).toBe("TEST_FIXTURE");
      expect(isNonBlockingSecretClassification(result.classification)).toBe(true);
      expect(severityForSecretClassification(result.classification)).toBe("info");
    });

    it("a real-format credential (sk_live_) in a test path is still REAL_SECRET -- test paths do not blanket-suppress known formats", () => {
      const result = classifySecretDetection({
        path: "test/security/leaked.js",
        value: "sk_live_abcdefghijklmnopqrstuvwxyz",
        variableName: "apiKey",
        line: 'const apiKey = "sk_live_abcdefghijklmnopqrstuvwxyz";',
        lineIndex: 0,
        fileLines: testLines('const apiKey = "sk_live_abcdefghijklmnopqrstuvwxyz";'),
      });
      expect(result.classification).toBe("REAL_SECRET");
    });
  });

  it("exports non-blocking classifications", () => {
    expect(isNonBlockingSecretClassification("TEST_FIXTURE")).toBe(true);
    expect(isNonBlockingSecretClassification("PLACEHOLDER")).toBe(true);
    expect(isNonBlockingSecretClassification("FALSE_POSITIVE")).toBe(true);
    expect(isNonBlockingSecretClassification("REAL_SECRET")).toBe(false);
    expect(SECRET_CLASSIFICATION_METADATA_KEY).toBe("secretClassification");
  });
});
