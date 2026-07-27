import type { CoreUniqueId } from "../contracts/identifiers";
import type { CoreObservationConfidence } from "../confidence/confidence.types";

export type CoreEvidenceOrigin = string;

export type CoreEvidence<TSource extends string = string> = {
  id: CoreUniqueId;
  source: TSource;
  detail: string;
  confidence: number;
  refId?: CoreUniqueId | null;
  executionId?: CoreUniqueId | null;
};

export type CoreEvidenceTrace = {
  evidenceId: CoreUniqueId;
  correlationKeys: string[];
  refs: CoreUniqueId[];
};

export type CoreEvidenceReference = {
  evidenceId: CoreUniqueId;
  label: string;
  origin: CoreEvidenceOrigin;
};

export type CoreEvidenceCorrelation = {
  keys: string[];
  evidenceIds: CoreUniqueId[];
  confidenceBand: CoreObservationConfidence;
};
