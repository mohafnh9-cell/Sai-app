import { randomUUID } from "node:crypto";
import type { AttackSeverity } from "../../../types";

export type AuthzFindingStatus = "candidate" | "confirmed" | "rejected" | "duplicate";

export type AuthzFindingRecord = {
  findingId: string;
  team: "authorization";
  specialist: string;
  category: string;
  title: string;
  founderSummary: string;
  technicalExplanation: string;
  role: string;
  resource: string;
  action: string;
  severity: AttackSeverity;
  confidence: number;
  status: AuthzFindingStatus;
  correlationKeys: string[];
  safeFixEligible: boolean;
  remediationDirection: string;
  replayEligible: boolean;
  provenance: string[];
  discoveredAt: string;
};

export function newAuthzFinding(
  input: Omit<AuthzFindingRecord, "findingId" | "discoveredAt" | "team"> & { findingId?: string }
): AuthzFindingRecord {
  return {
    findingId: input.findingId ?? randomUUID(),
    team: "authorization",
    discoveredAt: new Date().toISOString(),
    ...input,
  };
}

export function toAttackFinding(finding: AuthzFindingRecord): import("../../../types").AttackFinding {
  return {
    id: finding.findingId,
    title: finding.title,
    description: finding.founderSummary,
    domain: "authorization",
    severity: finding.severity,
    confidence: finding.confidence,
    evidenceIds: [],
    metadata: {
      team: "authorization",
      specialist: finding.specialist,
      status: finding.status,
      role: finding.role,
      resource: finding.resource,
      action: finding.action,
      correlationKeys: finding.correlationKeys,
      safeFixEligible: finding.safeFixEligible,
      replayEligible: finding.replayEligible,
      remediationDirection: finding.remediationDirection,
      technicalExplanation: finding.technicalExplanation,
      provenance: finding.provenance,
      category: finding.category,
    },
  };
}
