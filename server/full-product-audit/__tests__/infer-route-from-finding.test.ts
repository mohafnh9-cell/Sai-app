import { describe, expect, it } from "vitest";
import {
  inferHttpRouteFromFilePath,
  mapFindingToDynamicFixtures,
} from "../infer-route-from-finding";

describe("inferHttpRouteFromFilePath", () => {
  it("maps Next.js app router API routes", () => {
    expect(inferHttpRouteFromFilePath("app/api/orders/[id]/route.ts")).toBe("/api/orders/{id}");
    expect(inferHttpRouteFromFilePath("app/api/login/route.ts")).toBe("/api/login");
    expect(inferHttpRouteFromFilePath("src/app/api/users/[userId]/route.ts")).toBe("/api/users/{userId}");
  });

  it("maps pages router API routes", () => {
    expect(inferHttpRouteFromFilePath("pages/api/login.ts")).toBe("/api/login");
    expect(inferHttpRouteFromFilePath("pages/api/users/[userId].ts")).toBe("/api/users/{userId}");
  });

  it("returns null for non-route files", () => {
    expect(inferHttpRouteFromFilePath("lib/auth.ts")).toBeNull();
    expect(inferHttpRouteFromFilePath("components/Button.tsx")).toBeNull();
    expect(inferHttpRouteFromFilePath(null)).toBeNull();
  });

  it("normalizes URL paths with trailing segments into origin-only fixtures downstream", () => {
    const route = inferHttpRouteFromFilePath("app/api/orders/[id]/route.ts");
    expect(route).toBe("/api/orders/{id}");
  });
});

describe("mapFindingToDynamicFixtures", () => {
  it("maps IDOR findings to idorResourceB fixture path", () => {
    const result = mapFindingToDynamicFixtures({
      finding: {
        id: "f1",
        ruleId: "authz.insufficient",
        title: "IDOR",
        description: null,
        severity: "high",
        category: "authz",
        filePath: "app/api/orders/[id]/route.ts",
        recommendation: null,
        confidence: null,
        evidence: null,
      },
      adapterId: "idor-cross-tenant",
    });
    expect(result.testable).toBe(true);
    if (result.testable) {
      expect(result.route).toBe("/api/orders/{id}");
      expect(result.fixtures.paths?.idorResourceB).toBe("/api/orders/{id}");
    }
  });

  it("maps rate-limit findings to rateLimitVulnerable fixture path", () => {
    const result = mapFindingToDynamicFixtures({
      finding: {
        id: "f2",
        ruleId: "rate-limit.missing",
        title: "Missing rate limit",
        description: null,
        severity: "medium",
        category: "rate-limit",
        filePath: "app/api/login/route.ts",
        recommendation: null,
        confidence: null,
        evidence: null,
      },
      adapterId: "rate-limit-brute-force",
    });
    expect(result.testable).toBe(true);
    if (result.testable) {
      expect(result.fixtures.paths?.rateLimitVulnerable).toBe("/api/login");
    }
  });

  it("skips unknown routes safely", () => {
    const result = mapFindingToDynamicFixtures({
      finding: {
        id: "f3",
        ruleId: "authz.insufficient",
        title: "Authz",
        description: null,
        severity: "high",
        category: "authz",
        filePath: "lib/server/auth.ts",
        recommendation: null,
        confidence: null,
        evidence: null,
      },
      adapterId: "idor-cross-tenant",
    });
    expect(result.testable).toBe(false);
    if (!result.testable) {
      expect(result.reason).toContain("safe application endpoint");
    }
  });

  it("maps App Router pages only for the read-only security headers probe", () => {
    const finding = {
      id: "f4",
      ruleId: "security.area-baseline",
      title: "Web coverage",
      description: null,
      severity: "info",
      category: "web",
      filePath: "app/(auth)/forgot-password/page.tsx",
      recommendation: null,
      confidence: null,
      evidence: null,
    };

    const headers = mapFindingToDynamicFixtures({
      finding,
      adapterId: "security-headers-probe",
    });
    expect(headers.testable).toBe(true);
    if (headers.testable) {
      expect(headers.fixtures.paths?.securityHeaders).toBe("/forgot-password");
    }

    expect(
      mapFindingToDynamicFixtures({ finding, adapterId: "unauthenticated-endpoint" }).testable
    ).toBe(false);
  });
});
