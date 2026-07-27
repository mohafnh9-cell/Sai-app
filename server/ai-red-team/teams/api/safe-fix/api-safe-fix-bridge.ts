import type { ApiFindingRecord } from "../findings/api-finding";

export type ApiSafeFixCandidate = {
  findingId: string;
  projectId: string;
  organizationId: string;
  title: string;
  route: string;
  method: string;
  remediationDirection: string;
  replayEligible: boolean;
};

export function buildApiSafeFixCandidates(
  findings: ApiFindingRecord[],
  input: { projectId: string; organizationId: string }
): ApiSafeFixCandidate[] {
  return findings
    .filter((f) => f.safeFixEligible && f.status !== "duplicate" && f.status !== "rejected")
    .map((f) => ({
      findingId: f.findingId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      title: f.title,
      route: f.route,
      method: f.method,
      remediationDirection: f.remediationDirection,
      replayEligible: f.replayEligible,
    }));
}
