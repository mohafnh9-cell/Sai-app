import { AGENT_SECURITY_SCANNER_ID } from "../constants";
import { normalizeExternalFinding } from "../normalize-external-finding";
import type { ExternalConfidence, SecurityAnalysisFinding } from "../schema";
import { PROMPT_CATEGORY_REMEDIATION, PROMPT_INJECTION_SOURCE_TOOL } from "./constants";
import type { PromptInjectionTier, PromptRawFinding } from "./types";

function mapCategory(category: string): string {
  if (category.startsWith("prompt-injection")) return "prompt-injection";
  if (category === "exfiltration") return "exfiltration";
  if (category === "malicious-injection" || category === "system-manipulation") {
    return "prompt-injection";
  }
  return category;
}

function remediationFor(finding: PromptRawFinding): string {
  return (
    PROMPT_CATEGORY_REMEDIATION[finding.category] ??
    PROMPT_CATEGORY_REMEDIATION["prompt-injection-content"] ??
    "Review this prompt construction path and verify untrusted input cannot alter system instructions."
  );
}

export function promptRawFindingToSecurityAnalysis(
  finding: PromptRawFinding
): SecurityAnalysisFinding | null {
  const normalized = normalizeExternalFinding(
    {
      ruleId: finding.rule,
      severity: finding.severity,
      category: mapCategory(finding.category),
      message: finding.message,
      file: finding.file,
      line: finding.line,
      confidence: finding.confidence,
      action: finding.action,
      risk_score: finding.riskScore,
      matched_text: finding.match,
      metadata: {
        fix: remediationFor(finding),
        promptCategory: finding.category,
        promptInjectionTier: finding.tier,
      },
    },
    PROMPT_INJECTION_SOURCE_TOOL
  );

  if (!normalized) return null;

  return {
    ...normalized,
    remediation: remediationFor(finding),
    metadata: {
      ...(normalized.metadata ?? {}),
      promptInjection: {
        rule: finding.rule,
        category: finding.category,
        tier: finding.tier,
        match: finding.match ?? null,
        evidenceSource: AGENT_SECURITY_SCANNER_ID,
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: PROMPT_INJECTION_SOURCE_TOOL,
        confidence: finding.confidence as ExternalConfidence,
        verificationStatus: normalized.verificationStatus,
        action: finding.action,
      },
    },
  };
}

export function promptRawFindingsToSecurityAnalysis(
  findings: PromptRawFinding[]
): SecurityAnalysisFinding[] {
  return findings
    .map(promptRawFindingToSecurityAnalysis)
    .filter((finding): finding is SecurityAnalysisFinding => finding != null);
}

export function dedupePromptSecurityFindings(
  findings: SecurityAnalysisFinding[]
): SecurityAnalysisFinding[] {
  const seen = new Set<string>();
  const deduped: SecurityAnalysisFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.externalRuleId}|${finding.file ?? ""}|${finding.line ?? ""}|${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

export type { PromptInjectionTier };
