import type { AuthzFindingRecord } from "./authorization-finding";

export function validateAuthzFinding(finding: AuthzFindingRecord): AuthzFindingRecord {
  if (finding.confidence < 0 || finding.confidence > 1) {
    return { ...finding, confidence: Math.min(1, Math.max(0, finding.confidence)) };
  }
  return finding;
}

export function dedupeAuthzFindings(findings: AuthzFindingRecord[]): AuthzFindingRecord[] {
  const seen = new Set<string>();
  return findings.map((f) => {
    const key = `${f.category}|${f.resource}|${f.action}|${f.role}|${f.title}`;
    if (seen.has(key)) {
      return { ...f, status: "duplicate" as const };
    }
    seen.add(key);
    return f;
  });
}

export function confirmReplayFindings(findings: AuthzFindingRecord[]): AuthzFindingRecord[] {
  return findings.map((f) =>
    f.replayEligible && f.status === "candidate" ? { ...f, status: "confirmed" as const } : f
  );
}
