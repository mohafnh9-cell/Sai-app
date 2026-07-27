/** Stable traceability identifiers — domain-agnostic. */
export type CoreUniqueId = string;

export type CoreTraceRefs = {
  correlationId?: CoreUniqueId | null;
  executionId?: CoreUniqueId | null;
  graphNodeIds?: CoreUniqueId[];
  graphEdgeIds?: CoreUniqueId[];
  boundaryId?: CoreUniqueId | null;
  invariantId?: CoreUniqueId | null;
  attackCaseId?: CoreUniqueId | null;
  replayPlanId?: CoreUniqueId | null;
  evidenceIds?: CoreUniqueId[];
  capabilityId?: CoreUniqueId | null;
};
