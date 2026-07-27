import type { BrowserFindingRecord } from "./browser-findings";

/** Boundary for Safe Fix Engine (RT3) — creates candidates only; never auto-applies. */
export type BrowserSafeFixCandidate = {
  findingId: string;
  projectId: string;
  organizationId: string;
  title: string;
  route: string;
  remediationDirection: string;
  evidenceRefs: string[];
  replayPossible: boolean;
};

export function toSafeFixCandidate(
  finding: BrowserFindingRecord,
  input: { projectId: string; organizationId: string }
): BrowserSafeFixCandidate | null {
  if (!finding.safeFixEligible || finding.status !== "confirmed") return null;
  return {
    findingId: finding.findingId,
    projectId: input.projectId,
    organizationId: input.organizationId,
    title: finding.title,
    route: finding.route,
    remediationDirection: finding.remediationDirection,
    evidenceRefs: finding.evidenceRefs,
    replayPossible: true,
  };
}
