import { describe, expect, it } from "vitest";
import {
  deriveConfidenceLevel,
  deriveConfidenceFromEvidenceScore,
  formatConfidenceDistribution,
  legacyBandFromConfidenceLevel,
  summarizeConfidenceDistribution,
} from "../derive";
import {
  assertConfidenceVerificationInvariant,
  enforceAllowedConfidence,
  isConfidenceVerificationPairValid,
} from "../invariants";
import { CONFIDENCE_LEVELS } from "../types";
import { normalizeFinding } from "@/brain/production-verdict/normalize-finding";
import { correlateAuditFindings } from "@/server/full-product-audit/correlate-findings";
import { normalizeExternalFinding } from "@/features/security-analysis/normalize-external-finding";

describe("confidence contract", () => {
  it("maps numeric runtime evidence to VERIFIED", () => {
    const level = deriveConfidenceLevel({
      numericScore: 0.94,
      detectionMethod: "LIVE_VERIFICATION",
      hasRuntimeEvidence: true,
      verificationStatus: "CONFIRMED",
    });
    expect(level).toBe("VERIFIED");
  });

  it("maps strong static score to PROBABLE", () => {
    const level = deriveConfidenceLevel({ numericScore: 0.8, detectionMethod: "STATIC_ANALYSIS" });
    expect(level).toBe("PROBABLE");
  });

  it("maps weak score to SPECULATIVE", () => {
    const level = deriveConfidenceLevel({ numericScore: 0.2, llmOnly: true });
    expect(level).toBe("SPECULATIVE");
  });

  it("maps legacy high/medium/low bands", () => {
    expect(deriveConfidenceLevel({ legacyBand: "high" })).toBe("PROBABLE");
    expect(deriveConfidenceLevel({ legacyBand: "medium" })).toBe("INFERRED");
    expect(deriveConfidenceLevel({ legacyBand: "low" })).toBe("SPECULATIVE");
  });

  it("wraps compute-confidence score through deriveConfidenceFromEvidenceScore", () => {
    const result = deriveConfidenceFromEvidenceScore({
      detectionMethod: "STATIC_ANALYSIS",
      evidenceItems: [{ id: "1", kind: "observed", label: "Observed" }],
      severity: "high",
    });
    expect(CONFIDENCE_LEVELS).toContain(result.level);
    expect(result.numericScore).toBeGreaterThan(0);
  });
});

describe("confidence invariants", () => {
  it("forces CONFIRMED findings to VERIFIED confidence", () => {
    expect(enforceAllowedConfidence("CONFIRMED", "SPECULATIVE")).toBe("VERIFIED");
    expect(() => assertConfidenceVerificationInvariant("CONFIRMED", "PROBABLE")).toThrow();
  });

  it("restricts POTENTIAL verification to PROBABLE or INFERRED", () => {
    expect(isConfidenceVerificationPairValid("POTENTIAL", "PROBABLE")).toBe(true);
    expect(isConfidenceVerificationPairValid("POTENTIAL", "VERIFIED")).toBe(false);
  });

  it("restricts LIKELY verification to INFERRED or SPECULATIVE", () => {
    expect(isConfidenceVerificationPairValid("LIKELY", "INFERRED")).toBe(true);
    expect(isConfidenceVerificationPairValid("LIKELY", "VERIFIED")).toBe(false);
  });
});

describe("confidence distribution helpers", () => {
  it("summarizes finding confidence levels for verdict copy", () => {
    const summary = summarizeConfidenceDistribution([
      "VERIFIED",
      "VERIFIED",
      "PROBABLE",
      "INFERRED",
    ]);
    expect(formatConfidenceDistribution(summary)).toBe("2 Verified, 1 Probable, 1 Inferred");
  });

  it("maps confidence levels to legacy bands for persisted schema compatibility", () => {
    expect(legacyBandFromConfidenceLevel("VERIFIED")).toBe("high");
    expect(legacyBandFromConfidenceLevel("INFERRED")).toBe("medium");
    expect(legacyBandFromConfidenceLevel("SPECULATIVE")).toBe("low");
  });
});

describe("pipeline emitters", () => {
  it("assigns confidenceLevel to normalized verdict findings", () => {
    const finding = normalizeFinding({
      title: "Exposed API key",
      severity: "critical",
      category: "secrets",
      rule_id: "secrets.exposed",
      confidence: "high",
    });
    expect(CONFIDENCE_LEVELS).toContain(finding.confidenceLevel);
    expect(finding.confidenceLevel).not.toBeNull();
  });

  it("assigns confidenceLevel to correlated audit findings", () => {
    const findings = correlateAuditFindings({
      staticFindings: [
        {
          id: "static-1",
          ruleId: "auth.missing",
          title: "Missing auth",
          severity: "high",
          category: "authentication",
          confidence: "high",
        },
      ],
      attackFindings: [],
      executedAdapters: [],
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(CONFIDENCE_LEVELS).toContain(finding.confidenceLevel);
      expect(isConfidenceVerificationPairValid(finding.verificationStatus, finding.confidenceLevel)).toBe(true);
    }
  });

  it("assigns confidenceLevel to external scanner findings", () => {
    const finding = normalizeExternalFinding(
      {
        ruleId: "python.injection.sql-injection",
        severity: "error",
        confidence: "HIGH",
        message: "SQL injection detected",
      },
      "scan_security"
    );
    expect(finding).not.toBeNull();
    expect(CONFIDENCE_LEVELS).toContain(finding!.confidenceLevel);
    expect(isConfidenceVerificationPairValid(finding!.verificationStatus, finding!.confidenceLevel)).toBe(true);
    expect(finding!.confidenceLevel).not.toBe("VERIFIED");
  });

  it("never assigns VERIFIED confidence to UNVERIFIED findings", () => {
    const level = enforceAllowedConfidence("UNVERIFIED", "VERIFIED");
    expect(level).not.toBe("VERIFIED");
  });
});
