import {
  AGENT_SECURITY_SCANNER_ID,
  type ExternalSecuritySourceTool,
} from "./constants";
import { deriveInitialVerificationStatus } from "./derive-verification-status";
import type {
  AgentAction,
  ExternalConfidence,
  ExternalSeverity,
  RawExternalFinding,
  SecurityAnalysisFinding,
} from "./schema";
import { isExternalSecuritySourceTool } from "./schema";

const SEVERITY_MAP: Record<string, { severity: ExternalSeverity; severityRank: number }> = {
  error: { severity: "HIGH", severityRank: 3 },
  ERROR: { severity: "HIGH", severityRank: 3 },
  warning: { severity: "MEDIUM", severityRank: 2 },
  WARNING: { severity: "MEDIUM", severityRank: 2 },
  info: { severity: "INFO", severityRank: 0 },
  INFO: { severity: "INFO", severityRank: 0 },
  CRITICAL: { severity: "CRITICAL", severityRank: 4 },
  critical: { severity: "CRITICAL", severityRank: 4 },
  LOW: { severity: "LOW", severityRank: 1 },
  low: { severity: "LOW", severityRank: 1 },
  HIGH: { severity: "HIGH", severityRank: 3 },
  high: { severity: "HIGH", severityRank: 3 },
  MEDIUM: { severity: "MEDIUM", severityRank: 2 },
  medium: { severity: "MEDIUM", severityRank: 2 },
};

const DEFAULT_SEVERITY: { severity: ExternalSeverity; severityRank: number } = {
  severity: "MEDIUM",
  severityRank: 2,
};

const RULE_CATEGORY_MAP: Record<string, string> = {
  injection: "injection",
  crypto: "crypto",
  auth: "auth",
  xss: "xss",
  ssrf: "ssrf",
  path: "path-traversal",
  deserialization: "deserialization",
  info: "info-exposure",
  permissions: "permissions",
  logging: "info-exposure",
  secrets: "secrets",
  prompt: "prompt-injection",
  exfiltration: "exfiltration",
  supply: "supply-chain",
  command: "injection",
  sql: "injection",
};

export type NormalizeExternalFindingOptions = {
  includeRaw?: boolean;
};

function asRecord(value: unknown): RawExternalFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as RawExternalFinding;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractRuleId(finding: RawExternalFinding): string | null {
  return (
    readString(finding.ruleId) ??
    readString(finding.rule_id) ??
    readString(finding.id) ??
    readString(finding.rule)
  );
}

function inferCategory(ruleId: string | null): string | null {
  if (!ruleId) return null;
  const segments = ruleId.toLowerCase().split(".");
  for (const segment of segments) {
    if (RULE_CATEGORY_MAP[segment]) {
      return RULE_CATEGORY_MAP[segment];
    }
  }
  for (const segment of segments) {
    for (const [key, category] of Object.entries(RULE_CATEGORY_MAP)) {
      if (segment.includes(key)) {
        return category;
      }
    }
  }
  return null;
}

function normalizeConfidence(confidence: unknown): ExternalConfidence {
  const upper = String(confidence ?? "MEDIUM").toUpperCase();
  if (upper === "HIGH" || upper === "MEDIUM" || upper === "LOW") {
    return upper;
  }
  return "MEDIUM";
}

function normalizeAction(action: unknown): AgentAction | null {
  if (!action) return null;
  const upper = String(action).toUpperCase();
  if (upper === "BLOCK" || upper === "WARN" || upper === "ALLOW") {
    return upper;
  }
  if (upper === "LOG") {
    return "WARN";
  }
  return null;
}

function readMetadataField<T>(finding: RawExternalFinding, key: string): T | null {
  const metadata = finding.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  return ((metadata as Record<string, unknown>)[key] as T | undefined) ?? null;
}

function buildTitle(message: string, ruleId: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return ruleId;
  }
  const bracketMatch = trimmed.match(/^\[([^\]]+)\]/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }
  const firstLine = trimmed.split("\n")[0]?.trim() ?? trimmed;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

function buildRemediation(finding: RawExternalFinding): string | undefined {
  const metadata = finding.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const fix = readString((metadata as Record<string, unknown>).fix);
    if (fix) return fix;
  }
  const suggestedFix = finding.suggested_fix;
  if (suggestedFix && typeof suggestedFix === "object" && !Array.isArray(suggestedFix)) {
    const description = readString((suggestedFix as Record<string, unknown>).description);
    if (description) return description;
  }
  return undefined;
}

function buildEvidence(finding: RawExternalFinding): string | undefined {
  return (
    readString(finding.line_content) ??
    readString(finding.matched_text) ??
    readString(finding.contextNote) ??
    undefined
  );
}

function resolveSourceTool(
  finding: RawExternalFinding,
  sourceTool: ExternalSecuritySourceTool
): ExternalSecuritySourceTool {
  const perFinding = readString(finding.source_tool) ?? readString(finding.source);
  if (perFinding) {
    const normalized = perFinding.replace(/-/g, "_");
    if (normalized === "prompt_scanner") {
      return "scan_skill";
    }
    if (isExternalSecuritySourceTool(normalized)) {
      return normalized;
    }
  }
  return sourceTool;
}

function toSequraiRuleId(sourceTool: ExternalSecuritySourceTool, externalRuleId: string): string {
  return `agent-scanner.${sourceTool}.${externalRuleId}`;
}

/**
 * Normalize a raw finding from agent-security-scanner-mcp into SequrAI's security analysis model.
 * Concept adapted from agent-security-scanner-mcp/src/lib/normalize-finding.js (v4.5.8).
 */
export function normalizeExternalFinding(
  input: unknown,
  sourceTool: ExternalSecuritySourceTool,
  options: NormalizeExternalFindingOptions = {}
): SecurityAnalysisFinding | null {
  const finding = asRecord(input);
  if (!finding) {
    return null;
  }

  const externalRuleId = extractRuleId(finding) ?? "unknown";
  const resolvedSourceTool = resolveSourceTool(finding, sourceTool);
  const originalSeverity = readString(finding.severity);
  const mapped = (originalSeverity && SEVERITY_MAP[originalSeverity]) || DEFAULT_SEVERITY;
  const confidence = normalizeConfidence(finding.confidence ?? readMetadataField(finding, "confidence"));
  const action = normalizeAction(finding.action);
  const message = readString(finding.message) ?? "";
  const category =
    readString(finding.category) ?? inferCategory(externalRuleId) ?? "general";
  const file = readString(finding.file);
  const lineValue = readNumber(finding.line);
  const line = lineValue != null && lineValue > 0 ? Math.trunc(lineValue) : null;
  const columnValue = readNumber(finding.column);
  const column = columnValue != null && columnValue > 0 ? Math.trunc(columnValue) : null;
  const verificationStatus = deriveInitialVerificationStatus({
    sourceTool: resolvedSourceTool,
    confidence,
    action,
  });

  const normalized: SecurityAnalysisFinding = {
    scanner: AGENT_SECURITY_SCANNER_ID,
    sourceTool: resolvedSourceTool,
    ruleId: toSequraiRuleId(resolvedSourceTool, externalRuleId),
    externalRuleId,
    title: buildTitle(message, externalRuleId),
    description: message,
    message,
    category,
    severity: mapped.severity,
    originalSeverity,
    severityRank: mapped.severityRank,
    confidence,
    file,
    line,
    column: column ?? null,
    evidence: buildEvidence(finding),
    remediation: buildRemediation(finding),
    action,
    riskScore: readNumber(finding.risk_score),
    cwe: (finding.cwe as string | string[] | null | undefined) ?? readMetadataField(finding, "cwe"),
    owasp: (finding.owasp as string | string[] | null | undefined) ?? readMetadataField(finding, "owasp"),
    verificationStatus,
    metadata: {
      securityAnalysis: {
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: resolvedSourceTool,
        externalRuleId,
        verificationStatus,
        originalSeverity,
        action,
        riskScore: readNumber(finding.risk_score),
      },
      ...(options.includeRaw ? { externalRaw: finding } : {}),
    },
  };

  return normalized;
}

export function normalizeExternalFindings(
  findings: unknown,
  sourceTool: ExternalSecuritySourceTool,
  options: NormalizeExternalFindingOptions = {}
): SecurityAnalysisFinding[] {
  if (!Array.isArray(findings)) {
    return [];
  }
  return findings
    .map((finding) => normalizeExternalFinding(finding, sourceTool, options))
    .filter((finding): finding is SecurityAnalysisFinding => finding != null);
}
