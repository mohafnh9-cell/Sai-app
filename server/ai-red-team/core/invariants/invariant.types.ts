import type { CoreUniqueId } from "../contracts/identifiers";
import type { CoreEvidence } from "../evidence/evidence.types";
import type { CoreObservationConfidence } from "../confidence/confidence.types";

export type CoreInvariantCategory = string;

export type CoreInvariant<TCategory extends CoreInvariantCategory = CoreInvariantCategory> = {
  id: CoreUniqueId;
  invariantKey: string;
  title: string;
  description: string;
  category: TCategory;
  confidence: CoreObservationConfidence;
  evidence: CoreEvidence<string>[];
  metadata?: Record<string, unknown>;
};

export type CoreInvariantViolation = {
  invariantId: CoreUniqueId;
  detail: string;
  executionId?: CoreUniqueId | null;
};

export type CoreInvariantCollection<TCategory extends CoreInvariantCategory = CoreInvariantCategory> =
  {
    id: CoreUniqueId;
    invariants: CoreInvariant<TCategory>[];
    validationViolations: CoreInvariantViolation[];
    extractedAt: string;
  };

export type CoreInvariantBuilderContract<TInput, TCategory extends CoreInvariantCategory> = {
  extract(input: TInput): CoreInvariantCollection<TCategory>;
};
