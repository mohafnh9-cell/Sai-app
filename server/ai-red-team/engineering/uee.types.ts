import type { DiscoveryReport } from "../discovery/types";
import type { SecurityIntelligenceReport } from "../intelligence/models";
import type { AttackResult } from "../types";
import type { SecurityDecisionReport } from "../decision/decision-model";
import type { RedTeamProductionVerdict } from "../verdict/red-team-production-verdict";
import type { AttackCampaign } from "../fix-strategy/fix-strategy.types";

export type PreferredAI =
  | "cursor"
  | "claude_code"
  | "codex"
  | "gemini"
  | "cline"
  | "roo"
  | "continue"
  | "copilot"
  | "openai_agent"
  | "aider";

export type EngineeringStrategyVariant =
  | "quick_fix"
  | "production_fix"
  | "best_practice"
  | "architecture_refactor";

export type EngineeringStrategyOption = {
  variant: EngineeringStrategyVariant;
  title: string;
  advantages: string[];
  tradeoffs: string[];
  risk: "low" | "medium" | "high";
  engineeringCost: "low" | "medium" | "high";
  estimatedHours: number;
  confidence: number;
};

export type PlanRootCause = {
  id: string;
  title: string;
  description: string;
  kind: string;
  primary: boolean;
  findingIds: string[];
  sharedCauseIds: string[];
};

export type ArchitectureChange = {
  changeId: string;
  title: string;
  rationale: string;
  impact: "low" | "medium" | "high";
};

export type ImplementationStep = {
  stepId: string;
  title: string;
  why: string;
  impact: string;
  affectedFiles: string[];
};

export type PlanRegressionTest = {
  id: string;
  domain: string;
  level: "unit" | "integration" | "security";
  title: string;
  description: string;
};

export type ReplayRequirement = {
  mandatory: true;
  replayPlanIds: string[];
  status: "not_run" | "passed" | "failed";
  productionVerdictGate: true;
};

/** Canonical, AI-independent engineering plan. */
export type UniversalEngineeringPlan = {
  planId: string;
  version: number;
  summary: string;
  objectives: string[];
  attackSummary: string;
  rootCauses: PlanRootCause[];
  architectureChanges: ArchitectureChange[];
  implementationOrder: ImplementationStep[];
  affectedComponents: string[];
  affectedFiles: string[];
  securityImprovements: string[];
  constraints: string[];
  requiredTests: string[];
  regressionTests: PlanRegressionTest[];
  verificationSteps: string[];
  rollbackPlan: string[];
  deploymentNotes: string[];
  remainingRisks: string[];
  estimatedComplexity: "low" | "medium" | "high";
  estimatedEngineeringHours: number;
  confidenceScore: number;
  blastRadius: "low" | "medium" | "high";
  rollbackRisk: "low" | "medium" | "high";
  definitionOfDone: string[];
  strategies: EngineeringStrategyOption[];
  selectedStrategy: EngineeringStrategyVariant;
  replay: ReplayRequirement;
  campaign: Pick<AttackCampaign, "campaignId" | "goal" | "severity">;
};

export type VerificationEngineeringPlan = {
  planId: string;
  parentPlanId: string;
  summary: string;
  securityVerification: string[];
  replayValidation: string[];
  regressionTesting: string[];
  performanceValidation: string[];
  architectureValidation: string[];
  definitionOfDone: string[];
};

export type AdapterOutput = {
  adapterId: PreferredAI | "generic_markdown" | "json" | "yaml" | "rest" | "mcp";
  format: "prompt" | "markdown" | "json" | "yaml" | "instructions";
  content: string;
  tokenEstimate: number;
  generationTimeMs: number;
};

export type UniversalEngineeringEngineInput = {
  organizationId: string;
  projectId: string;
  requestId: string;
  discovery: DiscoveryReport;
  intelligence: SecurityIntelligenceReport;
  results: AttackResult[];
  securityDecision?: SecurityDecisionReport;
  productionVerdict?: RedTeamProductionVerdict;
  replayStatus?: "not_run" | "passed" | "failed";
  previousPlanVersion?: number;
  preferredAI?: PreferredAI | null;
  generateAllAdapters?: boolean;
};

export type UniversalEngineeringEngineResult = {
  engineeringPlanId: string;
  plan: UniversalEngineeringPlan;
  verificationPlan: VerificationEngineeringPlan;
  adapterOutputs: AdapterOutput[];
  primaryPrompt: string | null;
  primaryAdapterId: PreferredAI | null;
  alternatePlanGenerated: boolean;
  replayVerified: boolean;
  productionReadyViaReplayOnly: true;
  durationMs: number;
  observability: {
    campaignId: string;
    adapter: string | null;
    generationTimeMs: number;
    tokenCount: number;
    estimatedComplexity: string;
    selectedStrategy: string;
  };
  /** RT9 structured remediation inputs (when Business Logic Team ran). */
  businessLogicRemediationInputs?: import("../business-logic/integration/platform-payload").BusinessLogicUeeRemediationInput[];
  llmRemediationInputs?: import("../llm-team/integration/platform-payload").LlmUeeRemediationInput[];
};

export const SUPPORTED_PREFERRED_AIS: PreferredAI[] = [
  "cursor",
  "claude_code",
  "codex",
  "gemini",
  "cline",
  "roo",
  "continue",
  "copilot",
  "openai_agent",
  "aider",
];
