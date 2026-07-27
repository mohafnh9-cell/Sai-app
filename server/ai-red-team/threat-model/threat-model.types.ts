import type { CoreUniqueId } from "../core/contracts/identifiers";
import type { CoreFindingConfidence } from "../core/confidence/confidence.types";

export type ThreatScope = {
  organizationId: string;
  projectId: string;
  scanId: string;
  executionId: string;
  correlationId: string;
};

export type ThreatSourceReference = {
  kind:
    | "discovery"
    | "rt9_workflow"
    | "rt9_finding"
    | "rt9_precondition"
    | "rt9_asset"
    | "rt10_graph"
    | "rt10_boundary"
    | "rt10_finding"
    | "rt10_precondition"
    | "rt10_asset"
    | "intelligence_correlation"
    | "platform_metadata";
  refId: string;
  label: string;
};

export type ThreatEvidence = {
  id: CoreUniqueId;
  sources: ThreatSourceReference[];
  detail: string;
  confidence: CoreFindingConfidence;
};

export type ThreatMetadata = {
  generatedAt: string;
  generatorVersion: string;
  fingerprint: string;
  tags: string[];
};

export type ThreatCategory =
  | "spoofing"
  | "tampering"
  | "repudiation"
  | "information_disclosure"
  | "denial_of_service"
  | "elevation_of_privilege"
  | "business_abuse"
  | "ai_trust_violation";

export type ThreatActorKind =
  | "anonymous_user"
  | "authenticated_user"
  | "workspace_member"
  | "organization_admin"
  | "malicious_insider"
  | "compromised_account"
  | "compromised_agent"
  | "compromised_mcp_server"
  | "compromised_api"
  | "compromised_tool"
  | "compromised_integration"
  | "malicious_document_author"
  | "knowledge_base_editor"
  | "external_attacker"
  | "external_api_controller";

export type ThreatActor = {
  logicalId: CoreUniqueId;
  kind: ThreatActorKind;
  label: string;
  startingPrivileges: string[];
  requiredAccess: string[];
  supportedCapabilities: string[];
  controlledComponents: string[];
  reachableBoundaryIds: CoreUniqueId[];
  constraints: string[];
  evidence: ThreatEvidence[];
  confidence: CoreFindingConfidence;
};

export type ThreatCapability = {
  logicalId: CoreUniqueId;
  label: string;
  actorKinds: ThreatActorKind[];
  evidence: ThreatEvidence[];
};

export type ThreatObjectiveKind =
  | "privilege_escalation"
  | "data_exfiltration"
  | "prompt_extraction"
  | "credential_theft"
  | "business_logic_abuse"
  | "tenant_escape"
  | "tool_abuse"
  | "memory_poisoning"
  | "rag_poisoning"
  | "code_execution"
  | "persistence"
  | "denial_of_service"
  | "financial_abuse"
  | "configuration_manipulation"
  | "account_takeover"
  | "cross_tenant_access"
  | "integrity_violation"
  | "availability_impact";

export type ThreatObjective = {
  logicalId: CoreUniqueId;
  kind: ThreatObjectiveKind;
  label: string;
  protectedAssetIds: CoreUniqueId[];
  securityObjectiveIds: CoreUniqueId[];
  evidence: ThreatEvidence[];
};

export type ThreatSurfaceKind =
  | "endpoint"
  | "prompt"
  | "tool"
  | "agent"
  | "memory"
  | "knowledge_base"
  | "vector_store"
  | "oauth"
  | "session"
  | "secret"
  | "api"
  | "mcp_client"
  | "mcp_server"
  | "browser_flow"
  | "configuration"
  | "business_workflow"
  | "webhook"
  | "queue"
  | "persistence_boundary"
  | "external_integration";

export type ThreatSurface = {
  logicalId: CoreUniqueId;
  kind: ThreatSurfaceKind;
  label: string;
  sourceRefs: ThreatSourceReference[];
  boundaryIds: CoreUniqueId[];
  evidence: ThreatEvidence[];
  confidence: CoreFindingConfidence;
};

export type ThreatVector = {
  logicalId: CoreUniqueId;
  label: string;
  surfaceId: CoreUniqueId;
  actorKind: ThreatActorKind;
  evidence: ThreatEvidence[];
};

export type ThreatCondition = {
  logicalId: CoreUniqueId;
  label: string;
  satisfied: boolean;
  blocking: boolean;
  sourceRefs: ThreatSourceReference[];
};

export type ThreatConstraint = {
  logicalId: CoreUniqueId;
  label: string;
  enforced: boolean;
  reason: string;
};

export type SecurityObjectiveKind =
  | "confidentiality"
  | "integrity"
  | "availability"
  | "tenant_isolation"
  | "instruction_integrity"
  | "tool_authorization"
  | "workflow_integrity"
  | "memory_isolation"
  | "retrieval_integrity"
  | "identity_assurance"
  | "financial_integrity"
  | "configuration_integrity";

export type SecurityObjective = {
  logicalId: CoreUniqueId;
  kind: SecurityObjectiveKind;
  label: string;
  protectedAssetIds: CoreUniqueId[];
};

export type BusinessImpact = {
  logicalId: CoreUniqueId;
  summary: string;
  severityBand: "critical" | "high" | "medium" | "low";
  affectedAssetIds: CoreUniqueId[];
  evidence: ThreatEvidence[];
};

export type AttackCostLevel = "trivial" | "low" | "moderate" | "high" | "prohibitive";

export type AttackCost = {
  requiredTime: AttackCostLevel;
  requiredKnowledge: AttackCostLevel;
  requiredAccess: AttackCostLevel;
  requiredResources: AttackCostLevel;
  requiredPrivileges: AttackCostLevel;
  interactionComplexity: AttackCostLevel;
  detectionRisk: AttackCostLevel;
  reproducibility: AttackCostLevel;
  automationPotential: AttackCostLevel;
  explainability: string[];
};

export type ThreatFeasibility = "blocked" | "unlikely" | "conditional" | "feasible" | "highly_feasible";

export type ThreatPriority = "critical" | "high" | "medium" | "low" | "informational";

export type ThreatNodeKind =
  | "actor"
  | "surface"
  | "vector"
  | "boundary"
  | "precondition"
  | "path"
  | "chain"
  | "asset"
  | "impact"
  | "security_objective";

export type ThreatNode = {
  logicalId: CoreUniqueId;
  kind: ThreatNodeKind;
  refId: CoreUniqueId;
  label: string;
  scope: ThreatScope;
  evidence: ThreatEvidence[];
  confidence: CoreFindingConfidence;
};

export type ThreatRelationshipKind = "leads_to" | "crosses" | "targets" | "requires" | "violates";

export type ThreatRelationship = {
  logicalId: CoreUniqueId;
  kind: ThreatRelationshipKind;
  fromNodeId: CoreUniqueId;
  toNodeId: CoreUniqueId;
  evidence: ThreatEvidence[];
};

export type ThreatPath = {
  logicalId: CoreUniqueId;
  actorId: CoreUniqueId;
  surfaceId: CoreUniqueId;
  vectorId: CoreUniqueId;
  boundaryIds: CoreUniqueId[];
  preconditionIds: CoreUniqueId[];
  protectedAssetId: CoreUniqueId;
  objectiveId: CoreUniqueId;
  stepOrder: string[];
  evidence: ThreatEvidence[];
  feasibility: ThreatFeasibility;
};

export type ThreatChainStepKind =
  | "entry_point"
  | "precondition"
  | "initial_access"
  | "intermediate"
  | "boundary_crossing"
  | "privilege_escalation"
  | "lateral_movement"
  | "persistence"
  | "objective"
  | "detection_opportunity"
  | "cleanup_modeled";

export type ThreatChainStep = {
  logicalId: CoreUniqueId;
  order: number;
  kind: ThreatChainStepKind;
  label: string;
  nodeRefs: CoreUniqueId[];
  boundaryCrossingIds: CoreUniqueId[];
  expectedEvidence: string[];
  detectionOpportunity: string | null;
  cleanupModeled: string | null;
};

export type ThreatChain = {
  logicalId: CoreUniqueId;
  fingerprint: string;
  pathId: CoreUniqueId;
  steps: ThreatChainStep[];
  preconditionIds: CoreUniqueId[];
  protectedAssetIds: CoreUniqueId[];
  objectiveId: CoreUniqueId;
  attackCost: AttackCost;
  feasibility: ThreatFeasibility;
  priority: ThreatPriority;
  crossTeam: boolean;
  teams: Array<"rt9" | "rt10">;
  evidence: ThreatEvidence[];
};

export type ThreatScenario = {
  logicalId: CoreUniqueId;
  title: string;
  category: ThreatCategory;
  actorId: CoreUniqueId;
  objectiveId: CoreUniqueId;
  pathIds: CoreUniqueId[];
  chainIds: CoreUniqueId[];
  securityObjectiveIds: CoreUniqueId[];
  evidence: ThreatEvidence[];
};

export type ThreatModelSummary = {
  actorCount: number;
  surfaceCount: number;
  pathCount: number;
  chainCount: number;
  crossTeamChainCount: number;
  blockedChainCount: number;
  feasibilityBreakdown: Record<ThreatFeasibility, number>;
  priorityBreakdown: Record<ThreatPriority, number>;
};

export type ThreatModelContext = {
  scope: ThreatScope;
  discoveryReportId: string | null;
  intelligenceReportId: string | null;
  platformMetadataVersion: string | null;
  inputArtifactRefs: ThreatSourceReference[];
};

export type ThreatModel = {
  version: string;
  contractId: string;
  context: ThreatModelContext;
  actors: ThreatActor[];
  capabilities: ThreatCapability[];
  objectives: ThreatObjective[];
  surfaces: ThreatSurface[];
  vectors: ThreatVector[];
  securityObjectives: SecurityObjective[];
  businessImpacts: BusinessImpact[];
  conditions: ThreatCondition[];
  constraints: ThreatConstraint[];
  nodes: ThreatNode[];
  relationships: ThreatRelationship[];
  paths: ThreatPath[];
  chains: ThreatChain[];
  scenarios: ThreatScenario[];
  summary: ThreatModelSummary;
  metadata: ThreatMetadata;
};

export type ThreatModelValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type ThreatModelValidationResult = {
  valid: boolean;
  issues: ThreatModelValidationIssue[];
};

export type ThreatModelBuildInput = {
  scope: ThreatScope;
  discovery?: {
    reportId: string;
    potentialAttackSurface: Array<{ area: string; label: string; confidence: number }>;
    payments: Array<{ id: string; name: string }>;
    aiProviders: Array<{ id: string; name: string }>;
  };
  platform?: {
    version: string;
    missionControlPayload?: {
      businessLogic?: Record<string, unknown>;
      llm?: Record<string, unknown>;
    };
    protectedAssetsSummary?: unknown;
    attackPreconditionsSummary?: unknown;
  };
  rt9?: {
    workflows?: number;
    invariants?: number;
    findingIds?: string[];
    protectedAssets?: Array<{ id: string; label: string; type?: string }>;
    preconditions?: Array<{ id: string; label: string; blocking?: string[] }>;
  };
  rt10?: {
    graphNodeIds?: string[];
    boundaryIds?: string[];
    findingIds?: string[];
    protectedAssets?: Array<{ id: string; label: string; type?: string }>;
    preconditions?: Array<{ id: string; label: string; unsupported?: string[] }>;
  };
  intelligence?: {
    reportId: string;
    correlations: Array<{ kind: string; findingIds: string[]; domains?: string[] }>;
  };
};
