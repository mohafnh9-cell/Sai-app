import type { AttackCampaignStatus, AttackExecutionStatus, AttackFindingOutcome } from "../contracts/enums";

export type AttackCenterFeedItem = {
  id: string;
  eventType: string;
  occurredAt: string;
  executionId: string | null;
  stepId: string | null;
  label: string;
};

export type AttackCenterExecutionSummary = {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  adapterId: string;
  status: AttackExecutionStatus;
  progressPercent: number;
  estimatedRemainingMs: number | null;
  currentStepTitle: string | null;
};

export type AttackCenterStepItem = {
  id: string;
  kind: string;
  label: string;
  status: string;
  sortOrder: number;
  weight: number;
  durationMs: number | null;
};

export type AttackCenterCampaignView = {
  kind: "campaign";
  projectId: string;
  campaign: {
    id: string;
    status: AttackCampaignStatus;
    commitSha: string;
    runtimeMode: string;
    progressPercent: number;
    estimatedRemainingMs: number | null;
    totalScenarios: number;
    totalExecutions: number;
    completedExecutions: number;
    confirmedFindings: number;
    blockedExecutions: number;
    updatedAt: string;
  };
  executions: AttackCenterExecutionSummary[];
  feed: AttackCenterFeedItem[];
};

export type AttackCenterExecutionView = {
  kind: "execution";
  projectId: string;
  execution: {
    id: string;
    campaignId: string;
    scenarioId: string;
    status: AttackExecutionStatus;
    progressPercent: number;
    estimatedRemainingMs: number | null;
    currentStepTitle: string | null;
    elapsedMs: number;
  };
  steps: AttackCenterStepItem[];
  feed: AttackCenterFeedItem[];
};

export type AttackCenterFindingView = {
  kind: "finding";
  projectId: string;
  finding: {
    id: string;
    title: string;
    description: string;
    category: string;
    severity: string;
    outcome: AttackFindingOutcome;
    confidence: number;
    impact: string;
    rootCause: string | null;
  };
  mitigation: {
    plainLanguageExplanation: string;
    recommendedProtection: string;
    implementationSteps: string[];
    implementationRisk: string;
  } | null;
  safeFix: {
    id: string;
    status: string;
    cursorPrompt: string;
    confidence: number;
    attackFindingId: string;
  } | null;
  evidence: {
    expectedBehavior: string;
    observedBehavior: string;
    reproducibility: string;
  } | null;
  protection: {
    outcome: string;
    summary: string;
  } | null;
};

export type AttackCenterSnapshot =
  | AttackCenterCampaignView
  | AttackCenterExecutionView
  | AttackCenterFindingView;
