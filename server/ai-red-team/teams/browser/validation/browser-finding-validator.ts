import type { BrowserFindingRecord } from "../browser-findings";

export function scoreFindingConfidence(input: {
  reproducible: boolean;
  evidenceQuality: "low" | "medium" | "high";
  deterministic: boolean;
  specialistAgreement: number;
}): number {
  let score = 0.4;
  if (input.reproducible) score += 0.2;
  if (input.deterministic) score += 0.15;
  if (input.evidenceQuality === "high") score += 0.15;
  else if (input.evidenceQuality === "medium") score += 0.08;
  score += Math.min(0.15, input.specialistAgreement * 0.05);
  return Math.min(1, Math.round(score * 100) / 100);
}

export function validateBrowserFinding(finding: BrowserFindingRecord): BrowserFindingRecord {
  if (finding.status === "confirmed") return finding;
  const confidence = scoreFindingConfidence({
    reproducible: finding.reproductionSteps.length > 0,
    evidenceQuality: finding.evidenceRefs.length > 0 ? "medium" : "low",
    deterministic: finding.confidence >= 0.75,
    specialistAgreement: 1,
  });
  const merged = { ...finding, confidence: Math.max(finding.confidence, confidence) };
  if (merged.confidence >= 0.75 && merged.reproductionSteps.length > 0) {
    return { ...merged, status: "confirmed" };
  }
  return { ...merged, status: "candidate" };
}

export function dedupeBrowserFindings(findings: BrowserFindingRecord[]): BrowserFindingRecord[] {
  const seen = new Map<string, BrowserFindingRecord>();
  const out: BrowserFindingRecord[] = [];
  for (const finding of findings) {
    const key = `${finding.category}:${finding.route}:${finding.title}`;
    if (seen.has(key)) {
      out.push({ ...finding, status: "duplicate" });
      continue;
    }
    seen.set(key, finding);
    out.push(finding);
  }
  return out;
}
