import { describe, expect, it } from "vitest";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";
import { VERDICT_STATUS_LABELS } from "@/brain/production-verdict/schema";

const BASE = {
  projectId: "11111111-1111-4111-8111-111111111111",
  repositoryId: "11111111-1111-4111-8111-111111111111",
  scanId: "22222222-2222-4222-8222-222222222222",
  scanStatus: "completed",
  filesAnalyzed: 42,
};

describe("Production Verdict Engine", () => {
  it("returns ready_to_ship for secure repo", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      securityScore: 92,
      findings: [{ title: "Minor header suggestion", severity: "low", category: "web" }],
    });
    expect(verdict.status).toBe("ready_to_ship");
    expect(verdict.score).toBeGreaterThanOrEqual(85);
    expect(verdict.blockersCount).toBe(0);
  });

  it("returns not_ready for critical secret", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      securityScore: 64,
      findings: [
        {
          id: "f1",
          title: "Exposed API key in source",
          severity: "critical",
          category: "secrets",
          rule_id: "exposed-credential",
        },
        { id: "f2", title: "Unprotected admin route", severity: "high", category: "authorization" },
      ],
    });
    expect(verdict.status).toBe("not_ready");
    expect(verdict.criticalBlockersCount).toBeGreaterThanOrEqual(1);
    expect(verdict.topPriorities.length).toBeLessThanOrEqual(3);
  });

  it("groups duplicate authorization findings into one priority", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      securityScore: 55,
      findings: [
        { id: "a1", title: "Missing ownership check on /api/posts", severity: "high", category: "authorization" },
        { id: "a2", title: "Missing ownership check on /api/comments", severity: "high", category: "authorization" },
        { id: "a3", title: "RLS policy missing for profiles", severity: "high", category: "authorization" },
      ],
    });
    const grouped = verdict.topPriorities.find((p) => p.findingIds.length > 1);
    expect(grouped).toBeDefined();
  });

  it("returns insufficient_data for low coverage", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      filesAnalyzed: 1,
      securityScore: 80,
      findings: [],
    });
    expect(verdict.status).toBe("insufficient_data");
    expect(verdict.score).toBeNull();
  });

  it("returns analysis_failed when scan failed", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      scanStatus: "failed",
      securityScore: null,
      findings: [],
      filesAnalyzed: 0,
    });
    expect(verdict.status).toBe("analysis_failed");
    expect(VERDICT_STATUS_LABELS[verdict.status]).toBe("Analysis Failed");
  });

  it("uses deterministic summary when AI summary absent", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      securityScore: 50,
      findings: [{ title: "Missing rate limit", severity: "high", category: "web" }],
    });
    expect(verdict.executiveSummary.length).toBeGreaterThan(20);
    expect(verdict.executiveSummary).not.toContain("undefined");
  });

  it("preserves AI summary without changing status", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      securityScore: 50,
      findings: [{ title: "Missing rate limit", severity: "high", category: "web" }],
      aiExecutiveSummary: "Custom AI narrative for the team.",
    });
    expect(verdict.executiveSummary).toBe("Custom AI narrative for the team.");
    expect(verdict.status).toBe("needs_improvement");
  });

  it("calculates score delta vs previous", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      securityScore: 70,
      previousScore: 80,
      findings: [{ title: "New high issue", severity: "high", category: "security" }],
    });
    expect(verdict.scoreDelta).toBeLessThan(0);
  });

  it("tracks blocker introduction and resolution", () => {
    const increased = generateProductionVerdict({
      ...BASE,
      securityScore: 60,
      previousBlockersCount: 1,
      findings: [
        { title: "Issue A", severity: "critical", category: "secrets" },
        { title: "Issue B", severity: "high", category: "web" },
      ],
    }).verdict;
    expect(increased.introducedBlockers).toBeGreaterThan(0);

    const resolved = generateProductionVerdict({
      ...BASE,
      securityScore: 80,
      previousBlockersCount: 3,
      findings: [],
    }).verdict;
    expect(resolved.resolvedBlockers).toBe(3);
  });

  it("marks performance and testing as evaluated on full scans without baseline findings", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      securityScore: 75,
      filesAnalyzed: 120,
      findings: [],
    });
    const performance = verdict.evaluatedAreas.find((a) => a.key === "performance");
    const testing = verdict.evaluatedAreas.find((a) => a.key === "testing");
    expect(performance?.status).toBe("evaluated");
    expect(testing?.status).toBe("evaluated");
    expect(performance?.score).not.toBeNull();
  });

  it("labels projected score as estimate", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      securityScore: 60,
      findings: [
        { id: "x1", title: "Secret exposed", severity: "critical", category: "secrets" },
        { id: "x2", title: "Admin route open", severity: "high", category: "authorization" },
      ],
    });
    expect(verdict.projectedScoreIsEstimate).toBe(true);
    if (verdict.projectedScore != null && verdict.score != null) {
      expect(verdict.projectedScore).toBeGreaterThanOrEqual(verdict.score);
    }
  });

  it("high score with critical blocker stays not_ready", () => {
    const { verdict } = generateProductionVerdict({
      ...BASE,
      securityScore: 90,
      findings: [
        {
          title: "Production secret in env file",
          severity: "critical",
          category: "secrets",
          rule_id: "exposed-credential",
        },
      ],
    });
    expect(verdict.status).toBe("not_ready");
  });
});
