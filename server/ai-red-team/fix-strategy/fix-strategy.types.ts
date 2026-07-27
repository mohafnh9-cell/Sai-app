import type { DiscoveryReport } from "../discovery/types";
import type { SecurityIntelligenceReport } from "../intelligence/models";
import type { AttackResult } from "../types";
import type { SecurityDecisionReport } from "../decision/decision-model";
import type { RedTeamProductionVerdict } from "../verdict/red-team-production-verdict";

export type AttackCampaignStep = {
  label: string;
  findingId: string | null;
};

export type AttackCampaign = {
  campaignId: string;
  goal: string;
  steps: AttackCampaignStep[];
  findingIds: string[];
  severity: "low" | "medium" | "high" | "critical";
  source: "attack_chain" | "synthesized" | "rt11";
};

export type RootCauseKind =
  | "architectural"
  | "configuration"
  | "framework"
  | "developer_mistake"
  | "shared";

export type RootCause = {
  rootCauseId: string;
  title: string;
  description: string;
  kind: RootCauseKind;
  findingIds: string[];
  sharedWith: string[];
};

export type EffortComplexity = "low" | "medium" | "high";

export type FixStrategyVariant = "quick_fix" | "production_fix" | "best_practice" | "architecture_refactor";

export type FixStrategyOption = {
  variant: FixStrategyVariant;
  title: string;
  advantages: string[];
  tradeoffs: string[];
  estimatedEffort: EffortComplexity;
  engineeringTimeHours: number;
  risk: "low" | "medium" | "high";
  rollbackRisk: "low" | "medium" | "high";
  confidence: number;
};

export type GroupedFix = {
  fixId: string;
  rootCauseId: string;
  title: string;
  summary: string;
  findingIds: string[];
  dependsOnFixIds: string[];
  priorityScore: number;
  recommendedVariant: FixStrategyVariant;
  strategies: FixStrategyOption[];
  likelyFiles: string[];
  replayPlanIds: string[];
};

export type EngineeringPlan = {
  implementationOrder: string[];
  constraints: string[];
  architectureNotes: string[];
  migrationRequired: boolean;
  backwardCompatible: boolean;
};

export type RegressionTestSpec = {
  id: string;
  domain: string;
  level: "unit" | "integration" | "security";
  title: string;
  description: string;
};

export type SafeFixScore = {
  securityImprovement: number;
  maintainability: number;
  architecture: number;
  backwardCompatibility: number;
  technicalDebtReduction: number;
  overallQuality: number;
};

export type ReplayFixLink = {
  replayPlanId: string;
  findingIds: string[];
  fixId: string;
  status: "pending" | "passed" | "failed" | "not_run";
};

export type FixStrategyEngineInput = {
  organizationId: string;
  projectId: string;
  requestId: string;
  discovery: DiscoveryReport;
  intelligence: SecurityIntelligenceReport;
  results: AttackResult[];
  securityDecision?: SecurityDecisionReport;
  productionVerdict?: RedTeamProductionVerdict;
  replayStatus?: "not_run" | "passed" | "failed";
  previousStrategyRevision?: number;
  preferredAI?: import("../engineering/uee.types").PreferredAI | null;
  generateAllAdapters?: boolean;
};

export type FixStrategyReport = {
  strategyId: string;
  campaignId: string;
  strategyRevision: number;
  campaign: AttackCampaign;
  rootCauses: RootCause[];
  groupedFixes: GroupedFix[];
  engineeringPlan: EngineeringPlan;
  implementationPrompt: string;
  verificationPrompt: string;
  regressionTests: RegressionTestSpec[];
  engineeringReport: EngineeringReport;
  replayLinks: ReplayFixLink[];
  safeFixScore: SafeFixScore;
  replayVerified: boolean;
  alternateStrategyGenerated: boolean;
  productionReadyViaReplayOnly: boolean;
  durationMs: number;
  universalEngineering?: import("../engineering/uee.types").UniversalEngineeringEngineResult;
};

export type EngineeringReport = {
  executiveSummary: string;
  attackSummary: string;
  rootCauses: string[];
  fixStrategySummary: string;
  tradeoffs: string[];
  estimatedEffort: EffortComplexity;
  architectureImpact: string;
  filesAffected: string[];
  testingPlan: string[];
  deploymentImpact: string;
  remainingRisks: string[];
};
