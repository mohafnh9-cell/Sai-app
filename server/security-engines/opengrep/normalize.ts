import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { CanonicalEvidence, CanonicalSeverity, SequrAIFinding } from "@/server/security-evidence/canonical-finding";
import { deriveExploitability } from "@/server/security-evidence/canonical-finding";

/**
 * Shape of one entry in opengrep-core's real `results[]` JSON array --
 * verified directly against live binary output (see engine.ts header
 * comment), not assumed from documentation. Notably: opengrep-core does NOT
 * echo the rule's own `severity:` back in `extra` -- confirmed by inspecting
 * real output. Severity must come from SEVERITY_BY_RULE_ID below (SequrAI's
 * own mapping), never trusted blindly from the engine (section 7).
 */
export type OpenGrepMatch = {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    metadata?: { cwe?: string; owasp?: string; category?: string };
    dataflow_trace?: unknown;
    metavars?: Record<string, unknown>;
  };
};

/**
 * Deterministic severity mapping (section 7): SequrAI decides severity from
 * its OWN rule pack (server/security-engines/opengrep/rules/taint-rules.yaml)
 * by check_id, never from anything the external engine claims about itself.
 * Every rule id here must exist in that YAML file.
 */
const SEVERITY_BY_RULE_ID: Record<string, CanonicalSeverity> = {
  "js-sql-injection-taint": "high",
  "js-command-injection-taint": "high",
  "js-ssrf-taint": "high",
  "py-sql-injection-taint": "high",
  "py-command-injection-taint": "high",
  "py-ssrf-taint": "high",
};

function severityForRule(ruleId: string): CanonicalSeverity {
  return SEVERITY_BY_RULE_ID[ruleId] ?? "medium";
}

export function fromOpenGrepMatch(
  matches: OpenGrepMatch[],
  ctx: { scanId: string; projectId: string; organizationId: string; now?: string }
): { findings: SequrAIFinding[]; evidence: CanonicalEvidence[] } {
  const now = ctx.now ?? new Date().toISOString();
  const findings: SequrAIFinding[] = [];
  const evidence: CanonicalEvidence[] = [];

  for (const match of matches) {
    const hasTaintTrace = Boolean(match.extra.dataflow_trace);
    const evidenceItem: CanonicalEvidence = {
      id: randomUUID(),
      kind: hasTaintTrace ? "TAINT_FLOW" : "AST",
      label: match.extra.message.slice(0, 160),
      detail: JSON.stringify({
        message: match.extra.message,
        location: { path: match.path, ...match.start },
        dataflowTrace: match.extra.dataflow_trace ?? null,
      }),
      redacted: false,
      capturedAt: now,
    };
    evidence.push(evidenceItem);

    const severity = severityForRule(match.check_id);
    // Static+taint detection alone (no dynamic confirmation) is never
    // treated as CONFIRMED -- matches the Phase 34 rule that a static
    // finding, however strong the dataflow evidence, is not a confirmed
    // exploit. A taint trace is stronger than a bare regex match, so it
    // resolves to LIKELY rather than POTENTIAL.
    const verificationStatus = hasTaintTrace ? "LIKELY" : "POTENTIAL";
    const fingerprint = createHash("sha256")
      .update(`opengrep:${match.check_id}:${match.path}:${match.start.line}:${match.start.col}`)
      .digest("hex")
      .slice(0, 32);

    findings.push({
      id: `opengrep:${fingerprint}`,
      fingerprint,
      title: `${match.check_id}: ${match.extra.message.split(".")[0]?.slice(0, 120) ?? match.extra.message.slice(0, 120)}`,
      description: match.extra.message,
      category: match.extra.metadata?.category ?? "injection",
      severity,
      confidence: hasTaintTrace ? "high" : "medium",
      exploitability: deriveExploitability({ verificationStatus, severity, evidence: [evidenceItem] }),
      verificationStatus,
      sources: ["external_engine"],
      evidence: [evidenceItem],
      affectedFiles: [match.path],
      affectedEndpoints: [],
      affectedAssets: [],
      remediation:
        "Use a parameterized query, an argument-array process API, or validate/allowlist the destination before this value reaches its sink.",
      references: [],
      cwe: match.extra.metadata?.cwe ? [match.extra.metadata.cwe] : [],
      owasp: match.extra.metadata?.owasp ? [match.extra.metadata.owasp] : [],
      mitre: [],
      scanId: ctx.scanId,
      projectId: ctx.projectId,
      organizationId: ctx.organizationId,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { findings, evidence };
}
