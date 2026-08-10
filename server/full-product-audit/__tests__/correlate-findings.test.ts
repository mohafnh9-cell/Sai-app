import { describe, expect, it } from "vitest";
import { correlateAuditFindings, countAuditFindings } from "../correlate-findings";

describe("correlateAuditFindings", () => {
  it("marks CONFIRMED when static authz matches dynamic idor with confirmed outcome", () => {
    const findings = correlateAuditFindings({
      staticFindings: [
        {
          id: "s1",
          ruleId: "authz.insufficient",
          title: "Route has no visible authorization",
          severity: "medium",
          category: "authorization",
          filePath: "app/api/projects/route.ts",
        },
      ],
      attackFindings: [
        {
          id: "a1",
          title: "Cross-tenant IDOR",
          severity: "high",
          category: "authorization",
          outcome: "confirmed",
          adapterId: "idor-cross-tenant",
          impact: "Foreign tenant record returned",
        },
      ],
      executedAdapters: ["idor-cross-tenant"],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verificationStatus).toBe("CONFIRMED");
    expect(findings[0]?.source).toBe("both");
  });

  it("marks POTENTIAL when no matching security test exists", () => {
    const findings = correlateAuditFindings({
      staticFindings: [
        {
          id: "s1",
          ruleId: "injection.sql",
          title: "Dynamic SQL query construction",
          severity: "high",
          category: "injection",
        },
      ],
      attackFindings: [],
      executedAdapters: ["idor-cross-tenant"],
    });

    expect(findings[0]?.verificationStatus).toBe("POTENTIAL");
  });

  it("marks FALSE_POSITIVE when related adapter ran but did not confirm", () => {
    const findings = correlateAuditFindings({
      staticFindings: [
        {
          id: "s1",
          ruleId: "auth.missing",
          title: "Route has no visible authentication",
          severity: "medium",
          category: "authentication",
        },
      ],
      attackFindings: [
        {
          id: "a1",
          title: "Unauthenticated endpoint",
          severity: "high",
          category: "authentication",
          outcome: "not_exploitable",
          adapterId: "unauthenticated-endpoint",
        },
      ],
      executedAdapters: ["unauthenticated-endpoint"],
    });

    expect(findings.some((f) => f.verificationStatus === "FALSE_POSITIVE")).toBe(true);
  });

  it("counts severities and verification buckets", () => {
    const findings = correlateAuditFindings({
      staticFindings: [
        {
          id: "s1",
          ruleId: "secrets.exposed",
          title: "Hard-coded secret",
          severity: "critical",
          category: "secrets",
        },
        {
          id: "s2",
          ruleId: "validation.missing",
          title: "Missing validation",
          severity: "low",
          category: "validation",
        },
      ],
      attackFindings: [],
      executedAdapters: [],
    });

    const counts = countAuditFindings(findings);
    expect(counts.critical).toBe(1);
    expect(counts.low).toBe(1);
    expect(counts.potential).toBe(2);
  });
});
