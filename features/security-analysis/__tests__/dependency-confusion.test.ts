import { describe, expect, it } from "vitest";
import { checkDependencyConfusion } from "../package-security/dependency-confusion";

describe("checkDependencyConfusion", () => {
  it("does not flag well-known public scopes", () => {
    const packages = ["@babel/core", "@types/node", "@radix-ui/react-dialog", "@anthropic-ai/sdk", "@upstash/redis"];
    for (const packageName of packages) {
      expect(checkDependencyConfusion(packageName, "npm")).toBeNull();
    }
  });

  it("flags scopes that look internal/private", () => {
    const packages = ["@internal/tools", "@private-lib/utils", "@corp-utils/shared", "@company/internal-tool"];
    for (const packageName of packages) {
      const result = checkDependencyConfusion(packageName, "npm");
      expect(result?.rule).toBe("package.dependency-confusion.scoped-internal");
    }
  });

  it("still flags a scoped package that shares the EXACT name of a well-known public package", () => {
    // Phase 31.1: exact match only, not fuzzy similarity -- sharing the
    // precise bare name of a hugely popular package under an unrelated
    // scope is genuinely suspicious in a way a near-miss is not.
    const result = checkDependencyConfusion("@some-scope/express", "npm");
    expect(result?.rule).toBe("package.dependency-confusion.scoped-public-collision");
  });

  describe("Phase 31.1 -- real false positive: @radix-ui/rect vs react", () => {
    it("does NOT flag @radix-ui/rect as colliding with react (fuzzy near-miss, not identity)", () => {
      expect(checkDependencyConfusion("@radix-ui/rect", "npm")).toBeNull();
    });

    it("does NOT flag @types/react (the exact-match-by-design DefinitelyTyped convention)", () => {
      expect(checkDependencyConfusion("@types/react", "npm")).toBeNull();
      expect(checkDependencyConfusion("@types/node", "npm")).toBeNull();
    });

    it("still does not flag a merely-similar (non-exact) scoped name against a public package", () => {
      // "expres" (edit distance 1 from "express") must not trigger the
      // collision rule anymore -- that was the exact bug being fixed.
      expect(checkDependencyConfusion("@babel/expres", "npm")).toBeNull();
    });
  });
});
