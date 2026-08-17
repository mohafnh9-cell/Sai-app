import { AGENT_SECURITY_SCANNER_ID } from "../constants";
import { MCP_SECURITY_SOURCE_TOOL } from "./constants";
import { normalizeExternalFinding } from "../normalize-external-finding";
import type { ExternalConfidence, SecurityAnalysisFinding } from "../schema";
import { MCP_CATEGORY_REMEDIATION } from "./rules";
import type { McpRawFinding, McpRawSeverity } from "./types";

function severityToConfidence(severity: McpRawSeverity): ExternalConfidence {
  switch (severity) {
    case "ERROR":
      return "HIGH";
    case "WARNING":
      return "MEDIUM";
    default:
      return "LOW";
  }
}

function mapCategory(category: string): string {
  switch (category) {
    case "overly-broad-permissions":
    case "missing-input-validation":
      return "permissions";
    case "data-exfiltration":
      return "exfiltration";
    case "description-injection":
    case "unicode-poisoning":
    case "tool-name-spoofing":
    case "schema-manipulation":
    case "cross-tool-manipulation":
    case "rug-pull":
      return "supply-chain";
    case "insecure-patterns":
      return "injection";
    default:
      return category;
  }
}

export function mcpRawFindingToSecurityAnalysis(
  finding: McpRawFinding
): SecurityAnalysisFinding | null {
  const confidence = severityToConfidence(finding.severity);
  const normalized = normalizeExternalFinding(
    {
      ruleId: finding.rule,
      severity: finding.severity,
      category: mapCategory(finding.category),
      message: finding.message,
      file: finding.file,
      line: finding.line,
      confidence,
      line_content: finding.match,
      metadata: {
        fix: MCP_CATEGORY_REMEDIATION[finding.category],
        mcpCategory: finding.category,
      },
    },
    MCP_SECURITY_SOURCE_TOOL
  );

  if (!normalized) return null;

  return {
    ...normalized,
    metadata: {
      ...(normalized.metadata ?? {}),
      mcp: {
        rule: finding.rule,
        category: finding.category,
        match: finding.match ?? null,
        evidenceSource: AGENT_SECURITY_SCANNER_ID,
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: MCP_SECURITY_SOURCE_TOOL,
        confidence,
        verificationStatus: normalized.verificationStatus,
      },
    },
  };
}

export function mcpRawFindingsToSecurityAnalysis(
  findings: McpRawFinding[]
): SecurityAnalysisFinding[] {
  return findings
    .map(mcpRawFindingToSecurityAnalysis)
    .filter((finding): finding is SecurityAnalysisFinding => finding != null);
}

export function dedupeMcpSecurityFindings(
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
