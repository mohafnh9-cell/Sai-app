import { randomUUID } from "node:crypto";
import type { AttackSeverity } from "../../types";

export type BrowserFindingStatus =
  | "candidate"
  | "validating"
  | "confirmed"
  | "rejected"
  | "duplicate"
  | "accepted_risk"
  | "fixed"
  | "verified";

export type BrowserFindingRecord = {
  findingId: string;
  runId: string;
  team: "browser";
  specialist: string;
  category: string;
  title: string;
  founderSummary: string;
  technicalExplanation: string;
  affectedTarget: string;
  route: string;
  severity: AttackSeverity;
  confidence: number;
  exploitability: "none" | "low" | "medium" | "high";
  evidenceRefs: string[];
  reproductionSteps: string[];
  expectedBehavior: string;
  observedBehavior: string;
  remediationDirection: string;
  safeFixEligible: boolean;
  correlationKeys: string[];
  discoveredAt: string;
  status: BrowserFindingStatus;
};

export type BrowserEvidenceRecord = {
  id: string;
  findingId: string;
  kind: string;
  route: string | null;
  redactedPayload: Record<string, unknown>;
  screenshotRef: string | null;
  traceRef: string | null;
  capturedAt: string;
};

export function toAttackFinding(finding: BrowserFindingRecord): import("../../types").AttackFinding {
  return {
    id: finding.findingId,
    title: finding.title,
    description: finding.founderSummary,
    domain: "browser",
    severity: finding.severity,
    confidence: finding.confidence,
    evidenceIds: finding.evidenceRefs,
    metadata: {
      team: finding.team,
      specialist: finding.specialist,
      status: finding.status,
      route: finding.route,
      technicalExplanation: finding.technicalExplanation,
      safeFixEligible: finding.safeFixEligible,
      correlationKeys: finding.correlationKeys,
    },
  };
}

export function newBrowserFinding(
  input: Omit<BrowserFindingRecord, "findingId" | "discoveredAt" | "team"> & {
    findingId?: string;
  }
): BrowserFindingRecord {
  return {
    findingId: input.findingId ?? randomUUID(),
    team: "browser",
    discoveredAt: new Date().toISOString(),
    ...input,
  };
}
