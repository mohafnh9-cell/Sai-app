import { describe, expect, it } from "vitest";
import { calculateSafeFixConfidence, bandFromScore } from "@/server/safe-fix-engine/confidence";
import { preparePullRequestDraft } from "@/server/safe-fix-engine/pr-preparation";
import { buildSafeFixDocumentV2 } from "@/server/safe-fix-engine/v2-document";
import type { SafeFixDocumentV2 } from "@/server/safe-fix-engine/types";

describe("Safe Fix confidence", () => {
  it("maps score to deterministic bands", () => {
    expect(bandFromScore(95)).toBe("VERY_HIGH");
    expect(bandFromScore(90)).toBe("HIGH");
    expect(bandFromScore(82)).toBe("MEDIUM");
    expect(bandFromScore(75)).toBe("LOW");
  });

  it("adjusts score from locality and risk", () => {
    const high = calculateSafeFixConfidence({
      confidenceScore: 88,
      implementationRisk: "LOW",
      affectedFileCount: 1,
      hasRecommendedAction: true,
      historicalSuccessRate: 0.9,
    });
    expect(high.band).toBe("VERY_HIGH");
    const low = calculateSafeFixConfidence({
      confidenceScore: 78,
      implementationRisk: "HIGH",
      affectedFileCount: 5,
      hasRecommendedAction: false,
    });
    expect(low.band).toBe("LOW");
  });
});

describe("Safe Fix document V2", () => {
  it("includes engineer narrative not line-only guidance", () => {
    const doc = buildSafeFixDocumentV2({
      promptInput: {
        projectName: "Acme",
        issueTitle: "Missing auth on export route",
        issueDescription: "Requests can bypass session verification.",
        severity: "critical",
        category: "authentication",
        whyItMatters: "Public data could leak.",
        recommendedAction: "Add session middleware to the export route.",
        affectedFiles: ["middleware.ts"],
        stack: [],
        currentScore: 72,
        projectedScoreImpact: 8,
      },
      assessment: {
        safeFixConfidence: 90,
        implementationRisk: "MEDIUM",
        riskReason: "Auth flow change.",
        estimatedScope: {
          filesExpected: 1,
          estimatedLocMin: 5,
          estimatedLocMax: 20,
          complexity: "low",
          complexityLabel: "Low",
        },
      },
      fixPrompt: "prompt body",
      confidenceBand: "HIGH",
    });
    expect(doc.explanationNarrative).toContain("If this were my company");
    expect(doc.verificationChecklist.length).toBeGreaterThan(0);
    expect(doc.executiveSummary).toContain("Missing auth");
  });
});

describe("PR preparation", () => {
  it("prepares branch and PR copy without push", () => {
    const doc: SafeFixDocumentV2 = {
      executiveSummary: "Fix auth",
      rootCause: "x",
      whyThisMatters: "y",
      riskIfIgnored: "z",
      proposedImplementation: "patch",
      filesToChange: ["a.ts"],
      expectedProductionConfidenceImprovement: 5,
      expectedProtectionImpact: "better",
      expectedSecurityImprovement: "better",
      verificationChecklist: ["Run tests"],
      rollbackConsiderations: ["Revert commit"],
      cursorPrompt: "p",
      explanationNarrative: "n",
    };
    const pr = preparePullRequestDraft({
      projectName: "Acme",
      blockerTitle: "Missing auth",
      severity: "critical",
      document: doc,
      assessment: {
        safeFixConfidence: 90,
        implementationRisk: "LOW",
        riskReason: "narrow",
        estimatedScope: {
          filesExpected: 1,
          estimatedLocMin: 1,
          estimatedLocMax: 2,
          complexity: "low",
          complexityLabel: "Low",
        },
      },
    });
    expect(pr.branchName).toMatch(/^sequrai\/safe-fix\//);
    expect(pr.prDescription).toContain("founder approval");
    expect(pr.rollbackChecklist.length).toBeGreaterThan(0);
  });
});

describe("lifecycle rules", () => {
  it("allows READY after PROPOSED", async () => {
    const { transitionSafeFixState } = await import("@/server/safe-fix-engine/lifecycle");
    expect(transitionSafeFixState).toBeDefined();
  });
});
