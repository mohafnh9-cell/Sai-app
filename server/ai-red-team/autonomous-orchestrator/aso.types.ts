import type { DiscoveryReport } from "../discovery/types";
import type { AttackDomain } from "../types";
import type { ProductionMemorySnapshot } from "../intelligence/models";
import type { PreferredAI } from "../engineering/uee.types";
import type { EngineeringStrategyVariant } from "../engineering/uee.types";

export type OrchestratorTeamId =
  | "browser"
  | "authentication"
  | "api"
  | "authorization"
  | "business_logic"
  | "llm"
  | "adversarial"
  | "intelligence"
  | "decision"
  | "engineering"
  | "replay"
  | "verdict";

export type OrchestratorBudgetMode = "fast" | "balanced" | "deep" | "maximum";

export type ReplayStrategyMode = "full" | "partial" | "critical_only" | "regression";

export type DiscoverySignals = {
  hasBrowserSurface: boolean;
  hasAuthentication: boolean;
  hasApiSurface: boolean;
  hasAuthorizationModel: boolean;
  hasPayments: boolean;
  hasBusinessWorkflows: boolean;
  hasLlm: boolean;
  hasMcp: boolean;
  isStaticSite: boolean;
  frameworkHints: string[];
};

export type TeamSelection = {
  teamId: OrchestratorTeamId;
  selected: boolean;
  skipReason: string | null;
  attackDomain: AttackDomain | null;
  estimatedRuntimeMs: number;
  estimatedComplexity: "low" | "medium" | "high";
};

export type ExecutionGraphNode = {
  id: string;
  teamId: OrchestratorTeamId;
  label: string;
};

export type ExecutionGraphEdge = {
  from: string;
  to: string;
  kind: "depends_on" | "feeds";
};

export type ExecutionWave = {
  waveId: string;
  nodeIds: string[];
  parallel: boolean;
};

export type OrchestratorExecutionPlan = {
  planId: string;
  createdAt: string;
  budgetMode: OrchestratorBudgetMode;
  discoverySignals: DiscoverySignals;
  teamSelections: TeamSelection[];
  selectedTeams: OrchestratorTeamId[];
  skippedTeams: Array<{ teamId: OrchestratorTeamId; reason: string }>;
  executionGraph: { nodes: ExecutionGraphNode[]; edges: ExecutionGraphEdge[] };
  waves: ExecutionWave[];
  attackDomains: AttackDomain[];
  domainOrder: AttackDomain[];
  maxParallel: number;
  replayStrategy: ReplayStrategyMode;
  engineeringStrategy: EngineeringStrategyVariant;
  preferredAI: PreferredAI | null;
  generateAllAdapters: boolean;
  confidence: number;
  estimatedDurationMs: number;
  estimatedTokenUsage: number;
  schedulingMs: number;
  memoryHints: string[];
  /** RT9 scheduling metadata — never auto-executed by ASO. */
  businessLogicScheduling?: import("../business-logic/integration/platform-payload").BusinessLogicAsoOrchestrationHints | null;
  /** RT10 scheduling metadata — never auto-executed by ASO. */
  llmScheduling?: import("../llm-team/integration/platform-payload").LlmAsoOrchestrationHints | null;
};

export type AutonomousOrchestratorInput = {
  requestId: string;
  organizationId: string;
  projectId: string;
  discovery: DiscoveryReport;
  memory?: ProductionMemorySnapshot | null;
  budgetMode?: OrchestratorBudgetMode;
  userPreferences?: {
    preferredAI?: PreferredAI;
    deadlineHours?: number;
    generateAllAdapters?: boolean;
  };
  parallelExecutionEnabled?: boolean;
  adaptiveTeamSelection?: boolean;
  previousReplayFailed?: boolean;
};

export type OrchestratorDecision = {
  decisionId: string;
  executionPlan: OrchestratorExecutionPlan;
  rationale: string[];
};
