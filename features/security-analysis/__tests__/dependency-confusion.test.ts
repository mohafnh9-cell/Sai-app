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

  it("still flags scoped packages that collide with a known public package name", () => {
    const result = checkDependencyConfusion("@babel/expres", "npm");
    expect(result?.rule).toBe("package.dependency-confusion.scoped-public-collision");
  });
});
