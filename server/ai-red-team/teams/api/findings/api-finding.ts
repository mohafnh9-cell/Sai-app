import { randomUUID } from "node:crypto";
import type { AttackSeverity } from "../../../types";

export type ApiFindingStatus = "candidate" | "confirmed" | "rejected" | "duplicate";

export type ApiFindingRecord = {
  findingId: string;
  team: "api";
  specialist: string;
  category: string;
  title: string;
  founderSummary: string;
  technicalExplanation: string;
  route: string;
  method: string;
  severity: AttackSeverity;
  confidence: number;
  status: ApiFindingStatus;
  correlationKeys: string[];
  safeFixEligible: boolean;
  remediationDirection: string;
  replayEligible: boolean;
  provenance: string[];
  discoveredAt: string;
};

export function newApiFinding(
  input: Omit<ApiFindingRecord, "findingId" | "discoveredAt" | "team"> & { findingId?: string }
): ApiFindingRecord {
  return {
    findingId: input.findingId ?? randomUUID(),
    team: "api",
    discoveredAt: new Date().toISOString(),
    ...input,
  };
}

export function toAttackFinding(finding: ApiFindingRecord): import("../../../types").AttackFinding {
  return {
    id: finding.findingId,
    title: finding.title,
    description: finding.founderSummary,
    domain: "api",
    severity: finding.severity,
    confidence: finding.confidence,
    evidenceIds: [],
    metadata: {
      team: "api",
      specialist: finding.specialist,
      status: finding.status,
      route: finding.route,
      method: finding.method,
      correlationKeys: finding.correlationKeys,
      safeFixEligible: finding.safeFixEligible,
      replayEligible: finding.replayEligible,
      remediationDirection: finding.remediationDirection,
      technicalExplanation: finding.technicalExplanation,
      provenance: finding.provenance,
    },
  };
}
