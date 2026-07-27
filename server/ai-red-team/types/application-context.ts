import type { DiscoveryRepositoryInput } from "../discovery/types";

export type ApplicationContext = {
  projectId: string;
  organizationId: string;
  repositoryUrl?: string | null;
  defaultBranch?: string | null;
  /** Declared capabilities of the target app (e.g. "authentication", "payments"). */
  declaredCapabilities?: string[];
  metadata?: Record<string, unknown>;
};

export type AttackRequest = {
  requestId: string;
  context: ApplicationContext;
  /** Optional subset of attack domains to include in planning. */
  scope?: AttackDomain[];
  options?: AttackRunOptions;
  /** Inline repository snapshot for discovery (tests and pre-loaded runs). */
  discoveryRepository?: DiscoveryRepositoryInput;
  /**
   * When true (default for authorized attack runs), Director runs:
   * Discovery → Browser Team → Authentication Team → Intelligence → Decision → Production Verdict.
   */
  directorPipeline?: boolean;
  /** Authorized browser simulation (RT3). Requires valid AttackAuthorizationRecord. */
  attackSimulation?: {
    targetUrl: string;
    authorization: import("../authorization").AttackAuthorizationRecord;
    async?: boolean;
    idempotencyKey?: string;
  };
  intelligenceContext?: {
    memory?: import("../intelligence/models").ProductionMemorySnapshot | null;
    staticReviewConfidence?: number | null;
  };
  decisionContext?: {
    commitSha?: string | null;
    deploymentEnvironment?: import("../decision/decision-context").DeploymentEnvironment;
    memory?: import("../intelligence/models").ProductionMemorySnapshot | null;
    acceptedRisks?: import("../decision/decision-model").AcceptedRiskRecord[];
    safeFixStatus?: import("../decision/decision-context").SafeFixStatus;
    replayStatus?: import("../decision/decision-context").ReplayStatus;
    redTeamRunStatus?: import("../decision/decision-context").RedTeamRunStatus;
    evidenceCommitSha?: string | null;
    previousDecision?: import("../decision/decision-model").SecurityDecisionType | null;
    minCoverageScore?: number;
    fixStrategyRevision?: number;
    preferredAI?: import("../engineering/uee.types").PreferredAI;
    generateAllEngineeringAdapters?: boolean;
  };
  /** RT13 Autonomous Security Orchestrator inputs (optional — ASO fills defaults). */
  orchestrator?: {
    budgetMode?: import("../autonomous-orchestrator/aso.types").OrchestratorBudgetMode;
    userPreferences?: {
      preferredAI?: import("../engineering/uee.types").PreferredAI;
      deadlineHours?: number;
      generateAllAdapters?: boolean;
    };
    previousReplayFailed?: boolean;
  };
};

export const ATTACK_DOMAINS = [
  "authentication",
  "authorization",
  "browser",
  "api",
  "payments",
  "llm",
] as const;

export type AttackDomain = (typeof ATTACK_DOMAINS)[number];

export type AttackRunOptions = {
  timeoutMs?: number;
  maxParallel?: number;
  maxRetries?: number;
  signal?: AbortSignal;
};
