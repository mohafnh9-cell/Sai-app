import { describe, expect, it } from "vitest";
import { analyzeProjectContext, projectAwareRecommendation, resolveExistingAffectedFiles } from "../project-context";
import { computeConfidenceScore, confidencePercent } from "../compute-confidence";
import { computeFalsePositiveProbability, falsePositiveLabel } from "../compute-false-positive";
import { identifySecretProvider, secretRemediation } from "../secret-evidence";
import { postProcessScanFindings, shouldSuppressPublicWebsiteFinding } from "../enrich-scan-finding";
import { evaluateAttackOutcome } from "@/server/attack-simulation/mitigation/evaluate-outcome";
import type { Finding } from "@/features/security-scanner/types";
import { parseEvidenceReport } from "../schema";

describe("evidence-finding engine", () => {
  it("computes confidence from detection method and evidence items", () => {
    const result = computeConfidenceScore({
      detectionMethod: "MOCK_SIMULATION",
      evidenceItems: [
        { id: "1", kind: "observed", label: "Observed", confidence: 0.8 },
        { id: "2", kind: "http", label: "HTTP", confidence: 0.7 },
      ],
      severity: "high",
      hasRuntimeEvidence: true,
      hasReplayEvidence: false,
      signalHits: 2,
    });
    expect(result.confidence).toBeGreaterThan(0.65);
    expect(confidencePercent(result.confidence)).toBeGreaterThan(65);
    expect(result.explanation.length).toBeGreaterThan(10);
  });

  it("computes false positive probability with explanations", () => {
    const result = computeFalsePositiveProbability({
      detectionMethod: "STATIC_ANALYSIS",
      evidenceItems: [{ id: "1", kind: "regex", label: "Regex matched" }],
      counterEvidenceItems: [{ id: "2", kind: "test", label: "Test file" }],
      projectType: "marketing_website",
      ruleId: "auth.missing-route-guard",
      isSecretFinding: false,
    });
    expect(result.probability).toBeGreaterThan(0.2);
    expect(falsePositiveLabel(result.probability)).toBeTruthy();
  });

  it("identifies secret provider with partial fingerprint without exposing full secret", () => {
    const secret = identifySecretProvider({
      evidence: "OPENAI_API_KEY=[REDACTED]",
      fingerprintMaterial: "OPENAI_API_KEY",
    });
    expect(secret?.provider).toBe("OpenAI");
    expect(secret?.ruleId).toBe("OPENAI_API_KEY");
    expect(secret?.partialFingerprint).not.toContain("sk-");
    expect(secretRemediation({
      provider: secret!.provider,
      ruleId: secret!.ruleId,
      filePath: ".env.local",
      line: 12,
      partialFingerprint: secret!.partialFingerprint,
    })).toContain("OpenAI");
    expect(secretRemediation({
      provider: secret!.provider,
      ruleId: secret!.ruleId,
      filePath: ".env.local",
      line: 12,
      partialFingerprint: secret!.partialFingerprint,
    })).not.toMatch(/sk_live_[A-Za-z0-9]+/);
  });

  it("does not recommend middleware.ts when project has no middleware", () => {
    const context = analyzeProjectContext(["app/page.tsx", "app/api/users/route.ts"]);
    expect(context.hasMiddleware).toBe(false);
    const recommendation = projectAwareRecommendation({
      genericRecommendation: "Add auth middleware in middleware.ts",
      context,
    });
    expect(recommendation).not.toContain("middleware.ts");
    expect(recommendation).toContain("route");
  });

  it("does not recommend app/api when project only has pages/api", () => {
    const context = analyzeProjectContext(["pages/api/checkout.ts"]);
    const recommendation = projectAwareRecommendation({
      genericRecommendation: "Protect app/api/checkout/route.ts",
      context,
    });
    expect(recommendation).toContain("pages/api");
    expect(recommendation).not.toContain("app/api");
  });

  it("suppresses unauthenticated findings on marketing websites", () => {
    const finding: Finding = {
      id: "1",
      ruleId: "auth.missing-route-guard",
      title: "Unauthenticated endpoint",
      description: "Route accepts anonymous requests",
      severity: "high",
      confidence: "medium",
      category: "authentication",
      location: { path: "app/page.tsx", line: 1 },
      remediation: "Add auth middleware",
      fingerprint: "fp1",
    };
    const context = analyzeProjectContext(["app/page.tsx", "components/hero.tsx", "app/(marketing)/page.tsx"]);
    expect(context.projectType).toBe("marketing_website");
    expect(shouldSuppressPublicWebsiteFinding(finding, context)).toBe(true);
    const processed = postProcessScanFindings([finding], ["app/page.tsx", "components/hero.tsx"]);
    expect(processed).toHaveLength(0);
  });

  it("uses potential vulnerability wording for mock runtime exploit signals", () => {
    const result = evaluateAttackOutcome({
      evidence: {
        confidence: 0.7,
        expectedBehavior: "Tenant A should not read tenant B records",
        observedBehavior: "Returned tenant B record for cross-tenant request",
        sideEffects: {},
        statusCode: 200,
      },
      scenario: {
        adapterId: "idor-cross-tenant",
        title: "Cross-tenant IDOR",
        category: "authorization",
      },
      runtimeMode: "mock",
    });
    expect(result.confirmationStatus).toBe("potential");
    expect(result.outcome).toBe("inconclusive");
    expect(result.exploitable).toBe(true);
  });

  it("confirms only under sandbox or authorized staging runtime", () => {
    const sandbox = evaluateAttackOutcome({
      evidence: {
        confidence: 0.82,
        expectedBehavior: "Unauthorized denied",
        observedBehavior: "cross-tenant record returned",
        sideEffects: {},
        statusCode: 200,
      },
      scenario: { adapterId: "idor-cross-tenant", title: "IDOR", category: "authorization" },
      runtimeMode: "sandbox",
    });
    expect(sandbox.confirmationStatus).toBe("confirmed");
    expect(sandbox.outcome).toBe("confirmed");
  });

  it("serializes and parses evidence reports for backwards compatibility", () => {
    const report = postProcessScanFindings(
      [
        {
          id: "secrets.exposed:abc",
          ruleId: "secrets.exposed",
          title: "Hard-coded secret",
          description: "Credential in source",
          severity: "high",
          confidence: "high",
          category: "secrets",
          location: { path: ".env.local", line: 12 },
          evidence: "OPENAI_API_KEY=[REDACTED]",
          remediation: "Rotate credentials",
          fingerprint: "abc",
          metadata: { fingerprintMaterial: "OPENAI_API_KEY" },
        },
      ],
      [".env.local", "app/page.tsx"]
    )[0].metadata?.evidenceReport;

    const parsed = parseEvidenceReport(report);
    expect(parsed?.version).toBe(1);
    expect(parsed?.detectionMethod).toBe("STATIC_ANALYSIS");
    expect(parsed?.evidence.length).toBeGreaterThan(0);
    expect(parsed?.recommendedFix).toContain("OpenAI");
  });

  it("preserves external scanner trust metadata through postProcessScanFindings", () => {
    const processed = postProcessScanFindings(
      [
        {
          id: "dependencies.osv-sbom:abc",
          ruleId: "dependencies.osv-sbom",
          title: "Vulnerable dependency: lodash",
          description: "Known vulnerability in installed dependency.",
          severity: "high",
          confidence: "high",
          category: "supply-chain",
          location: { path: "package-lock.json", line: 10 },
          remediation: "Upgrade lodash",
          fingerprint: "abc",
          metadata: {
            securityAnalysis: {
              verificationStatus: "LIKELY",
              sourceTool: "osv",
            },
            evidenceReport: {
              version: 1,
              detectionMethod: "STATIC_ANALYSIS",
              confidence: 0.85,
              confidencePercent: 85,
              confidenceExplanation: "External security engine signal",
              falsePositiveProbability: 0.25,
              falsePositivePercent: 25,
              falsePositiveExplanation: "External scanner findings can be noisy",
              confirmationStatus: "potential_vulnerability",
              statusLabel: "Likely — strong signal, pending repository verification",
              evidence: [],
              counterEvidence: [],
              reasoning: "Known vulnerability in installed dependency.",
              affectedFiles: [{ path: "package-lock.json", line: 10, matchedRule: "dependencies.osv-sbom" }],
              matchedRules: [
                {
                  ruleId: "dependencies.osv-sbom",
                  ruleName: "Vulnerable dependency: lodash",
                  category: "supply-chain",
                },
              ],
              verificationStatus: "LIKELY",
              recommendedFix: "Upgrade lodash",
            },
          },
        },
      ],
      ["package-lock.json"]
    );

    expect(processed).toHaveLength(1);
    const report = parseEvidenceReport(processed[0]?.metadata?.evidenceReport);
    expect(report?.confirmationStatus).toBe("potential_vulnerability");
    expect(report?.confirmationStatus).not.toBe("confirmed");
    expect(processed[0]?.metadata?.findingClassification).not.toBe("production_blocker");
  });

  it("resolves affected files to paths that exist in the repository", () => {
    const context = analyzeProjectContext(["app/api/users/route.ts", "lib/auth/session.ts"]);
    const files = resolveExistingAffectedFiles(["middleware.ts", "app/api/**/route.ts"], context);
    expect(files.some((path) => path.includes("app/api/users/route.ts"))).toBe(true);
    expect(files.some((path) => path.endsWith("middleware.ts"))).toBe(false);
  });
});
