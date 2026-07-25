import { describe, expect, it } from "vitest";
import { buildFounderSummary } from "@/server/protection-reports/founder-summary";
import { formatMonthlyReportNarrative } from "@/server/protection-reports/narrative";
import type { ProtectionReportData } from "@/server/protection-reports/types";

const sampleData: ProtectionReportData = {
  protectionStatus: { start: "safe_with_caution", end: "protected", endLabel: "PROTECTED" },
  productionConfidence: { start: 89, end: 96, delta: 7 },
  securityConfidence: { start: 94, end: 98, delta: 4 },
  whatImproved: ["Production confidence 89% → 96%."],
  whatBecameWorse: [],
  openRecommendations: ["Authentication improvement on public API"],
  topPriorities: ["One authentication improvement."],
  statistics: {
    dailyChecksCompleted: 29,
    fullReviews: 2,
    alertsImportant: 2,
    unsafeDeploymentsPrevented: 3,
    criticalIssuesFixed: 5,
    safeFixesApplied: 4,
    recommendationsCompleted: 3,
    daysInPeriod: 30,
  },
  milestones: [],
  projectEvolution: [],
  continuousProtectionOn: true,
};

describe("founder summary", () => {
  it("answers the five founder questions", () => {
    const founder = buildFounderSummary("monthly", sampleData, "Acme");
    expect(founder.moreProtectedThanPriorPeriod).toBe(true);
    expect(founder.whatImproved.length).toBeGreaterThan(0);
    expect(founder.whatWorriesSequrAI.length).toBeGreaterThan(0);
    expect(founder.whatToDoNext).toContain("Safe Fix");
    expect(founder.wouldDeployToday).toContain("company");
  });
});

describe("monthly narrative", () => {
  it("includes proof statistics and status", () => {
    const founder = buildFounderSummary("monthly", sampleData, "Acme");
    const text = formatMonthlyReportNarrative("Acme", "2026-07-01", sampleData, founder);
    expect(text).toContain("SEQURAI MONTHLY PROTECTION REPORT");
    expect(text).toContain("PROTECTED");
    expect(text).toContain("Unsafe deployments prevented");
    expect(text).toContain("96%");
  });
});
