import { describe, expect, it } from "vitest";
import { determineVerdictStatus } from "@/brain/production-verdict/status-rules";
import { scoreFindings, type Finding } from "../index";

function finding(
  overrides: Partial<Finding> & Pick<Finding, "severity" | "ruleId">
): Finding {
  const id = overrides.id ?? `${overrides.ruleId}-${overrides.severity}`;
  return {
    id,
    fingerprint: id,
    correlationKey: id,
    title: overrides.title ?? "Finding",
    description: overrides.description ?? "Finding",
    category: overrides.category ?? "test",
    confidence: overrides.confidence ?? "high",
    location: overrides.location ?? { path: "src/example.ts", line: 1 },
    remediation: overrides.remediation ?? "Fix it",
    ...overrides,
  };
}

function totalRawPenalty(result: ReturnType<typeof scoreFindings>): number {
  return Object.values(result.deductions).reduce((sum, value) => sum + value, 0);
}

/** Mirrors the latest sequrai-app scan distribution (46 findings, raw penalty 127). */
function buildObservedDistributionFindings(extra: Finding[] = []): Finding[] {
  const findings: Finding[] = [];

  for (let index = 0; index < 7; index += 1) {
    findings.push(
      finding({
        id: `open-redirect-${index}`,
        ruleId: "web.open-redirect",
        severity: "medium",
        confidence: "medium",
        category: "web",
        location: { path: "app/api/github/app/setup/route.ts", line: index + 1 },
      })
    );
  }

  for (let index = 0; index < 3; index += 1) {
    findings.push(
      finding({
        id: `rate-limit-auth-${index}`,
        ruleId: "rate-limit.auth-missing",
        severity: "high",
        confidence: "medium",
        category: "availability",
        location: { path: `app/oauth/route-${index}.ts`, line: 1 },
      })
    );
  }

  const mediumRules = [
    "auth.missing",
    "authz.insufficient",
    "validation.client-only-risk",
    "web.csrf-missing",
    "agent-scanner.scan_mcp_server.mcp.url-no-validation",
  ];
  for (let index = 0; index < 16; index += 1) {
    findings.push(
      finding({
        id: `medium-${index}`,
        ruleId: mediumRules[index % mediumRules.length]!,
        severity: "medium",
        confidence: index % 3 === 0 ? "high" : index % 3 === 1 ? "medium" : "low",
        category: "validation",
        location: { path: `app/oauth/medium-${index}.ts`, line: 1 },
      })
    );
  }

  for (let index = 0; index < 10; index += 1) {
    findings.push(
      finding({
        id: `low-${index}`,
        ruleId: "validation.missing",
        severity: "low",
        confidence: "low",
        category: "validation",
        location: { path: `app/oauth/low-${index}.ts`, line: 1 },
      })
    );
  }

  for (let index = 0; index < 10; index += 1) {
    findings.push(
      finding({
        id: `info-${index}`,
        ruleId: "security.area-baseline",
        severity: "info",
        confidence: "high",
        category: "architecture",
        location: { path: `.env.example`, line: index + 1 },
      })
    );
  }

  return [...findings, ...extra];
}

describe("scoreFindings calibration", () => {
  it("returns 100 when there are no findings", () => {
    expect(scoreFindings([])).toMatchObject({ score: 100, grade: "A" });
  });

  it("does not deduct for info-only findings", () => {
    const result = scoreFindings([
      finding({ ruleId: "security.area-baseline", severity: "info" }),
      finding({ id: "info-2", ruleId: "readiness.area-baseline", severity: "info" }),
    ]);
    expect(result.score).toBe(100);
    expect(totalRawPenalty(result)).toBe(0);
  });

  it("applies a small reduction for a single low finding", () => {
    const result = scoreFindings([finding({ ruleId: "validation.missing", severity: "low" })]);
    expect(result.score).toBeGreaterThanOrEqual(88);
    expect(result.score).toBeLessThan(100);
  });

  it("decreases progressively for medium findings without immediately reaching 0", () => {
    const five = scoreFindings(
      Array.from({ length: 5 }, (_, index) =>
        finding({
          id: `medium-${index}`,
          ruleId: `validation.missing-${index}`,
          severity: "medium",
        })
      )
    );
    const ten = scoreFindings(
      Array.from({ length: 10 }, (_, index) =>
        finding({
          id: `medium-${index}`,
          ruleId: `validation.missing-${index}`,
          severity: "medium",
        })
      )
    );
    const fifteen = scoreFindings(
      Array.from({ length: 15 }, (_, index) =>
        finding({
          id: `medium-${index}`,
          ruleId: `validation.missing-${index}`,
          severity: "medium",
        })
      )
    );

    expect(five.score).toBeGreaterThan(ten.score);
    expect(ten.score).toBeGreaterThan(fifteen.score);
    expect(fifteen.score).toBeGreaterThan(0);
    expect(fifteen.score).toBeLessThan(five.score);
  });

  it("applies a substantial reduction for three high findings", () => {
    const result = scoreFindings(
      Array.from({ length: 3 }, (_, index) =>
        finding({
          id: `high-${index}`,
          ruleId: `rate-limit.auth-missing-${index}`,
          severity: "high",
          confidence: "medium",
        })
      )
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(70);
  });

  it("strongly reduces score for critical findings without always forcing 0", () => {
    const oneCritical = scoreFindings([
      finding({ ruleId: "secrets.exposed", severity: "critical" }),
    ]);
    const twoCritical = scoreFindings([
      finding({ id: "critical-1", ruleId: "secrets.exposed", severity: "critical" }),
      finding({ id: "critical-2", ruleId: "supabase.service-role-client", severity: "critical" }),
    ]);

    expect(oneCritical.score).toBeGreaterThan(0);
    expect(oneCritical.score).toBeLessThan(85);
    expect(twoCritical.score).toBeLessThan(oneCritical.score);
  });

  it("can reach 0 when cumulative critical/high volume is severe", () => {
    const result = scoreFindings(
      Array.from({ length: 12 }, (_, index) =>
        finding({
          id: `critical-${index}`,
          ruleId: `secrets.exposed-${index}`,
          severity: "critical",
        })
      )
    );
    expect(totalRawPenalty(result)).toBeGreaterThan(250);
    expect(result.score).toBe(0);
  });

  it("scores the observed 46-finding distribution above 0", () => {
    const result = scoreFindings(buildObservedDistributionFindings());
    expect(result.counts).toMatchObject({
      critical: 0,
      high: 3,
      medium: 23,
      low: 10,
      info: 10,
    });
    expect(totalRawPenalty(result)).toBeGreaterThan(100);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(20);
    expect(result.score).toBeLessThanOrEqual(45);
  });

  it("improves score when two false-positive critical service-role findings are removed", () => {
    const withFalsePositives = scoreFindings(
      buildObservedDistributionFindings([
        finding({
          id: "service-role-install",
          ruleId: "supabase.service-role-client",
          severity: "critical",
          location: { path: "app/api/github/app/install/route.ts", line: 1 },
        }),
        finding({
          id: "service-role-setup",
          ruleId: "supabase.service-role-client",
          severity: "critical",
          location: { path: "app/api/github/app/setup/route.ts", line: 1 },
        }),
      ])
    );
    const withoutFalsePositives = scoreFindings(buildObservedDistributionFindings());

    expect(withFalsePositives.counts.critical).toBe(2);
    expect(withoutFalsePositives.counts.critical).toBe(0);
    expect(withoutFalsePositives.score).toBeGreaterThan(withFalsePositives.score);
  });

  it("documents that score is independent of deployment readiness", () => {
    const posture = scoreFindings([
      finding({ ruleId: "readiness.area-baseline", severity: "info" }),
    ]);

    const status = determineVerdictStatus({
      scanStatus: "completed",
      score: posture.score,
      criticalBlockersCount: 1,
      highBlockersCount: 0,
      hasSufficientCoverage: true,
      findings: [
        {
          id: "critical-blocker",
          title: "Exposed production secret",
          severity: "critical",
          category: "secrets",
          ruleId: "secrets.exposed",
          confidence: "high",
        },
      ],
    });

    expect(posture.score).toBe(100);
    expect(status).toBe("not_ready");
  });
});
