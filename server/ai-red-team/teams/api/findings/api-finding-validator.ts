import type { ApiFindingRecord } from "./api-finding";

export function validateApiFinding(finding: ApiFindingRecord): ApiFindingRecord {
  if (finding.status === "confirmed") return finding;
  if (finding.confidence >= 0.8 && finding.provenance.length >= 2) {
    return { ...finding, status: "confirmed" };
  }
  return { ...finding, status: "candidate" };
}

export function dedupeApiFindings(findings: ApiFindingRecord[]): ApiFindingRecord[] {
  const seen = new Map<string, ApiFindingRecord>();
  const out: ApiFindingRecord[] = [];
  for (const f of findings) {
    const key = `${f.method}:${f.route}:${f.category}:${f.title}`;
    if (seen.has(key)) {
      out.push({ ...f, status: "duplicate" });
    } else {
      seen.set(key, f);
      out.push(f);
    }
  }
  return out;
}
