import type { CoreUniqueId } from "../contracts/identifiers";
import type { CoreFindingSeverity } from "../severity/severity.types";
import type { CoreFindingConfidence } from "../confidence/confidence.types";
import type { CoreEvidence } from "../evidence/evidence.types";
import type { CoreTraceRefs } from "../contracts/identifiers";

export type CoreFindingStatus = "candidate" | "confirmed" | "duplicate" | "rejected";

export type CoreFindingCategory = string;

export type CoreFindingImpact = {
  summary: string;
  businessImpact: string;
  trustImpact: string;
  affectedAssets: string[];
};

export type CoreRecommendationContext = {
  id: CoreUniqueId;
  kind: string;
  statement: string;
};

export type CoreFindingCorrelation = {
  keys: string[];
  rootCause: string;
  affectedComponentIds: CoreUniqueId[];
};

export type CoreFindingMetadata = {
  teamRunId: CoreUniqueId | null;
  executionId: CoreUniqueId;
  executionMode: string;
  generatedAt: string;
  providerFamily: string | null;
};

export type CoreFinding<
  TCategory extends CoreFindingCategory = CoreFindingCategory,
  TEvidenceSource extends string = string,
> = {
  findingId: CoreUniqueId;
  findingKey: string;
  title: string;
  description: string;
  category: TCategory;
  severity: CoreFindingSeverity;
  confidence: CoreFindingConfidence;
  status: CoreFindingStatus;
  impact: CoreFindingImpact;
  evidence: CoreEvidence<TEvidenceSource>[];
  correlation: CoreFindingCorrelation;
  metadata: CoreFindingMetadata;
  traceability: CoreTraceRefs;
};

export type CoreFindingCollection<TFinding extends CoreFinding = CoreFinding> = {
  id: CoreUniqueId;
  generatedAt: string;
  findings: TFinding[];
  validationIssues: Array<{ findingId?: CoreUniqueId; code: string; message: string }>;
};

export type CoreFindingBuilderContract<TInput, TFinding extends CoreFinding> = {
  build(input: TInput): CoreFindingCollection<TFinding>;
};

export type CoreFindingCorrelationContract<TFinding extends CoreFinding = CoreFinding> = {
  correlate(findings: TFinding[]): TFinding[];
};
