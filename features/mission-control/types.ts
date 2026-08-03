import type { ProductionVerdictV1, VerdictStatus } from "@/brain/production-verdict/schema";
import type { Translator } from "@/lib/i18n/types";

export type MissionTeamId =
  | "browser"
  | "authentication"
  | "api"
  | "authorization"
  | "business_logic"
  | "llm"
  | "adversarial";

export type MissionTeamStatus = "running" | "queued" | "completed" | "skipped" | "failed";

export type MissionHeaderState = {
  missionTitle: string;
  projectName: string;
  statusLabel: string;
  progressPercent: number;
  etaLabel: string;
  currentPhase: string;
};

export type MissionTeamCard = {
  id: MissionTeamId;
  name: string;
  status: MissionTeamStatus;
  estimatedDurationLabel: string;
  progressPercent: number;
};

export type MissionTeamReason = {
  teamId: MissionTeamId;
  teamName: string;
  reason: string;
  confidence: "high" | "medium" | "low";
};

export type MissionFeedItem = {
  id: string;
  message: string;
  occurredAt: string;
};

export type MissionObjectiveState = {
  title: string;
  estimatedEffortLabel: string;
  engineeringPlanStatus: "ready" | "pending" | "none";
  replayStatus: "passed" | "pending" | "failed" | "not_run";
  primaryAction: "generate_fix" | "analyze" | "view_details";
  priorityId?: string;
};

export type MissionVerdictDisplay = string;

export type MissionVerdictCard = {
  display: MissionVerdictDisplay;
  confidence: string;
  criticalCampaigns: number;
  replayStatusLabel: string;
  engineeringPlanStatusLabel: string;
  deploymentRecommendation: string;
  verdictStatus: VerdictStatus;
  score: number;
};

export type MissionControlView = {
  projectId: string;
  header: MissionHeaderState;
  teams: MissionTeamCard[];
  teamReasons: MissionTeamReason[];
  feed: MissionFeedItem[];
  objective: MissionObjectiveState;
  verdict: MissionVerdictCard;
  detailsHref?: string;
  fixPromptContext?: {
    projectName: string;
    currentVerdictStatus: VerdictStatus;
    currentScore: number;
  };
  cancelledReview?: MissionCancelledReview | null;
  hideProductionVerdict?: boolean;
};

export type MissionCancelledReview = {
  cancelledAt: string;
  cancelledByUserId: string | null;
  lastCompletedPhase: string | null;
  progressAtCancellation: number;
};

export type MissionControlBuildInput = {
  projectId: string;
  projectName: string;
  verdict: ProductionVerdictV1 | null;
  scanInProgress: boolean;
  detectedStack?: Record<string, unknown> | null;
  feedFromDb: MissionFeedItem[];
  sessionProgress?: number | null;
  sessionPhase?: string | null;
  sessionEtaSeconds?: number | null;
  /** Optional red-team execution snapshot (e.g. from scan job metadata). */
  teamExecution?: Partial<Record<MissionTeamId, MissionTeamStatus>>;
  /** RT9 business logic metrics when available on scan metadata. */
  businessLogicMetrics?: import("@/server/ai-red-team/business-logic/integration/platform-payload").BusinessLogicMissionControlMetrics;
  /** RT10 LLM metrics when available on scan metadata. */
  llmMetrics?: import("@/server/ai-red-team/llm-team/integration/platform-payload").LlmMissionControlMetrics;
  cancelledReview?: MissionCancelledReview | null;
  t?: Translator;
};

export const MISSION_TEAMS: Array<{ id: MissionTeamId; name: string }> = [
  { id: "browser", name: "Browser Team" },
  { id: "authentication", name: "Authentication Team" },
  { id: "api", name: "API Team" },
  { id: "authorization", name: "Authorization Team" },
  { id: "business_logic", name: "Business Logic Team" },
  { id: "llm", name: "LLM Team" },
  { id: "adversarial", name: "Adversarial Team" },
];
