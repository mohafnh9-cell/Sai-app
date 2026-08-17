import { AGENT_SECURITY_SCANNER_ID } from "../constants";
import { normalizeExternalFinding } from "../normalize-external-finding";
import type { SecurityAnalysisFinding } from "../schema";
import { AGENT_ACTION_CATEGORY_REMEDIATION, AGENT_ACTION_SOURCE_TOOL } from "./constants";
import { mapSeverityToExternal } from "./action-checks";
import type { AgentActionRawFinding } from "./types";

function remediationFor(finding: AgentActionRawFinding): string {
  return (
    AGENT_ACTION_CATEGORY_REMEDIATION[finding.category] ??
    "Review this agent tool capability and apply least-privilege restrictions before production use."
  );
}

export function agentActionRawFindingToSecurityAnalysis(
  finding: AgentActionRawFinding
): SecurityAnalysisFinding | null {
  const normalized = normalizeExternalFinding(
    {
      ruleId: finding.rule,
      severity: mapSeverityToExternal(finding.severity),
      category: finding.category,
      message: finding.message,
      file: finding.file,
      line: finding.line,
      confidence: finding.confidence,
      action: finding.action,
      matched_text: finding.match,
      metadata: {
        fix: remediationFor(finding),
        agentActionTier: finding.tier,
        actionType: finding.actionType,
        toolName: finding.toolName,
      },
    },
    AGENT_ACTION_SOURCE_TOOL
  );

  if (!normalized) return null;

  return {
    ...normalized,
    remediation: remediationFor(finding),
    metadata: {
      ...(normalized.metadata ?? {}),
      agentAction: {
        rule: finding.rule,
        category: finding.category,
        tier: finding.tier,
        actionType: finding.actionType,
        toolName: finding.toolName ?? null,
        match: finding.match ?? null,
        evidenceSource: AGENT_SECURITY_SCANNER_ID,
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: AGENT_ACTION_SOURCE_TOOL,
        confidence: finding.confidence,
        verificationStatus: normalized.verificationStatus,
        action: finding.action,
      },
    },
  };
}

export function agentActionRawFindingsToSecurityAnalysis(
  findings: AgentActionRawFinding[]
): SecurityAnalysisFinding[] {
  return findings
    .map(agentActionRawFindingToSecurityAnalysis)
    .filter((finding): finding is SecurityAnalysisFinding => finding != null);
}

export function dedupeAgentSecurityFindings(
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
