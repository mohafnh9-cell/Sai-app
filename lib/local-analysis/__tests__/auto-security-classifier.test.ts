import { describe, expect, it } from "vitest";
import { classifySecurityRelevance } from "../auto-security-classifier";

describe("Auto-Security MVP: classifySecurityRelevance", () => {
  it("test #1: a non-security change (docs/README only) does not trigger", () => {
    const result = classifySecurityRelevance(["README.md", "docs/setup.mdx"]);
    expect(result.relevant).toBe(false);
  });

  it("no changed files at all is never relevant", () => {
    expect(classifySecurityRelevance([]).relevant).toBe(false);
  });

  it("test #2: a security-sensitive change (API route) triggers", () => {
    const result = classifySecurityRelevance(["app/api/projects/route.ts"]);
    expect(result.relevant).toBe(true);
    expect(result.matchedPaths).toContain("app/api/projects/route.ts");
  });

  it("auth/authorization/middleware/database/RLS/secrets/dependency/CI paths all trigger", () => {
    const paths = [
      "lib/auth/session.ts",
      "lib/authz/policy.ts",
      "middleware.ts",
      "server/db/client.ts",
      "database/migrations/099_rls.sql",
      ".env.production",
      "package.json",
      "pnpm-lock.yaml",
      ".github/workflows/deploy.yml",
      "Dockerfile",
      ".cursor/hooks.json",
    ];
    for (const path of paths) {
      const result = classifySecurityRelevance([path]);
      expect(result.relevant, `expected "${path}" to be classified relevant`).toBe(true);
    }
  });

  it("one security-relevant file among many low-relevance ones still triggers", () => {
    const result = classifySecurityRelevance(["README.md", "app/api/admin/route.ts", "styles/main.css"]);
    expect(result.relevant).toBe(true);
    expect(result.matchedPaths).toEqual(["app/api/admin/route.ts"]);
  });

  it("an unrecognized plain code file is treated as relevant (uncertain -> trigger bias)", () => {
    const result = classifySecurityRelevance(["components/Widget.tsx"]);
    expect(result.relevant).toBe(true);
  });

  it("pure cosmetic/formatting changes (CSS only) do not trigger", () => {
    const result = classifySecurityRelevance(["styles/theme.css", "styles/layout.scss"]);
    expect(result.relevant).toBe(false);
  });
});
