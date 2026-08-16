import { describe, expect, it } from "vitest";
import {
  buildFindingCorrelationKey,
  normalizeRepoRelativePath,
} from "@/lib/correlation/finding-identity";

describe("finding correlation identity", () => {
  it("normalizes paths and ignores absolute prefixes", () => {
    expect(normalizeRepoRelativePath("./src/config.ts")).toBe("src/config.ts");
    expect(normalizeRepoRelativePath("src/../src/config.ts")).toBe("src/config.ts");
    expect(normalizeRepoRelativePath("/Users/dev/repo/src/config.ts")).toBe(
      "users/dev/repo/src/config.ts"
    );
  });

  it("builds stable keys for same rule/path/material", () => {
    const a = buildFindingCorrelationKey({
      ruleId: "secrets.exposed",
      filePath: "src/config.ts",
      fingerprintMaterial: "abc123",
    });
    const b = buildFindingCorrelationKey({
      ruleId: "secrets.exposed",
      filePath: "./src/config.ts",
      fingerprintMaterial: "abc123",
    });
    expect(a).toBe(b);
  });

  it("does not include line numbers in correlation key", () => {
    const key = buildFindingCorrelationKey({
      ruleId: "secrets.exposed",
      filePath: "src/config.ts",
      fingerprintMaterial: "token",
    });
    expect(key).not.toContain("42");
  });
});
