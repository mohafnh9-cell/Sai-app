import type { AttackFinding, AttackResult } from "../types";
import type { DiscoveryReport } from "../discovery/types";

export type IntelligenceNodeKind =
  | "route"
  | "endpoint"
  | "component"
  | "framework"
  | "authentication"
  | "database"
  | "llm"
  | "payment"
  | "finding"
  | "evidence"
  | "role"
  | "privilege"
  | "configuration"
  | "external_service";

export type IntelligenceEdgeKind =
  | "depends_on"
  | "reachable_from"
  | "uses"
  | "exposes"
  | "escalates_to"
  | "shares_context"
  | "caused_by"
  | "confirmed_by"
  | "fixed_by"
  | "verified_by";

export type IntelligenceGraphNode = {
  id: string;
  kind: IntelligenceNodeKind;
  label: string;
  domain?: string;
  metadata?: Record<string, unknown>;
};

export type IntelligenceGraphEdge = {
  from: string;
  to: string;
  kind: IntelligenceEdgeKind;
  weight?: number;
  metadata?: Record<string, unknown>;
};

export type IntelligenceAttackGraph = {
  nodes: IntelligenceGraphNode[];
  edges: IntelligenceGraphEdge[];
};

export type CorrelationKind =
  | "same_issue"
  | "independent"
  | "attack_chain"
  | "duplicate"
  | "supporting_evidence"
  | "possible_exploit_path";

export type FindingCorrelationGroup = {
  id: string;
  kind: CorrelationKind;
  findingIds: string[];
  confidence: number;
  rationale: string;
};

export type AttackChainStep = {
  findingId: string | null;
  nodeId: string;
  label: string;
};

export type AttackChain = {
  id: string;
  steps: AttackChainStep[];
  severity: "low" | "medium" | "high" | "critical";
  score: number;
  findingIds: string[];
  summary: string;
};

export type BusinessImpactDimension = "confidentiality" | "integrity" | "availability";

export type BusinessImpactAssessment = {
  findingId: string;
  headline: string;
  narrative: string;
  dimensions: Record<BusinessImpactDimension, "none" | "low" | "medium" | "high">;
  financialImpact: "none" | "low" | "medium" | "high";
  trustImpact: "none" | "low" | "medium" | "high";
  deploymentImpact: "none" | "low" | "medium" | "high";
};

export type RemediationPriority =
  | "fix_immediately"
  | "fix_before_production"
  | "fix_this_sprint"
  | "monitor"
  | "accepted_risk";

export type PrioritizedRemediation = {
  findingId: string;
  priority: RemediationPriority;
  score: number;
  rationale: string;
  chainId?: string | null;
};

export type ConfidenceBand = "very_high" | "high" | "medium" | "low" | "unknown";

export type FindingConfidence = {
  findingId: string;
  band: ConfidenceBand;
  score: number;
  sources: string[];
};

export type IntelligenceProductionVerdictStatus =
  | "SAFE_TO_DEPLOY"
  | "DEPLOY_WITH_MINOR_IMPROVEMENTS"
  | "DO_NOT_DEPLOY"
  | "UNKNOWN";

export type IntelligenceProductionVerdict = {
  status: IntelligenceProductionVerdictStatus;
  summary: string;
  businessExplanation: string;
  technicalExplanation: string;
  topRisks: string[];
  topFixes: string[];
  confidence: ConfidenceBand;
  coverage: string[];
  generatedAt: string;
};

export type FounderExplanation = {
  headline: string;
  paragraphs: string[];
  groupedFindingCount: number;
  rawFindingCount: number;
  estimatedRiskReductionPercent: number | null;
};

export type MemoryLink = {
  findingId: string;
  linkedEventTypes: string[];
  previouslyFixed: boolean;
  regressed: boolean;
  note: string | null;
};

export type GroupedSafeFixPlan = {
  id: string;
  title: string;
  findingIds: string[];
  chainId?: string | null;
  remediationSummary: string;
  estimatedFindingsResolved: number;
};

export type ProductionMemorySnapshot = {
  events: Array<{ type: string; payload: Record<string, unknown>; occurredAt: string }>;
};

export type SecurityIntelligenceInput = {
  discovery: DiscoveryReport;
  results: AttackResult[];
  memory?: ProductionMemorySnapshot | null;
  staticReviewConfidence?: number | null;
};

export type SecurityIntelligenceReport = {
  reportId: string;
  generatedAt: string;
  graph: IntelligenceAttackGraph;
  correlations: FindingCorrelationGroup[];
  attackChains: AttackChain[];
  businessImpacts: BusinessImpactAssessment[];
  priorities: PrioritizedRemediation[];
  findingConfidences: FindingConfidence[];
  verdict: IntelligenceProductionVerdict;
  explanation: FounderExplanation;
  memoryLinks: MemoryLink[];
  groupedSafeFixPlans: GroupedSafeFixPlan[];
  deduplicatedFindings: AttackFinding[];
  /** RT9 business logic intelligence (when Business Logic Team ran). */
  businessLogic?: import("../business-logic/integration/platform-payload").BusinessLogicIntelligenceBundle;
  /** RT10 LLM / AI intelligence (when LLM Team ran). */
  llm?: import("../llm-team/integration/platform-payload").LlmIntelligenceBundle;
};

export type NormalizedObservation = AttackFinding & {
  team: string;
  specialist?: string;
  route?: string;
  correlationKeys: string[];
  status?: string;
};
