import type { ProductionVerdictV1, VerdictStatus } from "./production-verdict/schema";

export const BRAIN_VERSION = "0.1.0";

export type ReadinessDimensionKey =
  | "security"
  | "architecture"
  | "bestPractices"
  | "performance"
  | "authentication"
  | "databaseDesign"
  | "deploymentReadiness";

export type ReadinessDimensions = Record<ReadinessDimensionKey, number | null>;

export type ProductionReadyScore = {
  overall: number | null;
  dimensions: ReadinessDimensions;
  blockersCount: number;
  improvementsCount: number;
  estimatedMinutesToReady: number;
  readyForProduction: boolean;
};

export type BrainPriority = {
  rank: number;
  title: string;
  description: string;
  estimatedMinutes?: number;
  source: "ai" | "scan";
};

export type BrainActivityEvent = {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  occurredAt: string;
  source: "repository_activity" | "security_timeline";
};

/**
 * How a persisted verdict relates to the version being analyzed.
 * current: it belongs to the latest completed analysis. historical_review_in_progress: a review of a newer version is
 * running, so it is HISTORY. pending_verdict: a newer scan completed but its own verdict is not persisted yet.
 * none: there is no verdict.
 */
export type BrainVerdictState = "current" | "historical_review_in_progress" | "pending_verdict" | "none";

export type ProjectBrainSnapshot = {
  projectId: string;
  organizationId: string;
  projectName: string;
  githubRepo: string | null;
  /**
   * Canonical persisted Production Verdict v1 — single source of truth.
   * Only a CURRENT verdict (`verdictState === "current"`) describes the latest version of the code.
   * While a review of a newer version is running it is HISTORY: it is kept for context, `productionReady`
   * is withheld, and it must never be read as an approval of the version being analyzed.
   */
  currentVerdict: ProductionVerdictV1 | null;
  /**
   * current: the verdict belongs to the latest completed analysis.
   * historical_review_in_progress: a review of a newer version is running; `currentVerdict` is historical.
   * pending_verdict: a newer scan completed but its own verdict is not persisted yet; no verdict is exposed.
   * none: no verdict exists.
   */
  verdictState: BrainVerdictState;
  /** The review currently running on the default branch (the version being analyzed), if any. */
  reviewInProgress: { scanId: string; commitSha: string | null } | null;
  productionReady: ProductionReadyScore;
  securityScore: number | null;
  riskScore: number | null;
  healthStatus: string | null;
  lastScanAt: string | null;
  lastCommitSha: string | null;
  webhookEnabled: boolean;
  todayPriorities: BrainPriority[];
  coachTip: string | null;
  executiveSummary: string | null;
  recentActivity: BrainActivityEvent[];
  snapshotAt: string;
  brainVersion: typeof BRAIN_VERSION;
};

export type ProjectBrainSummary = {
  projectId: string;
  projectName: string;
  productionReady: number | null;
  scoreDelta: number | null;
  projectedScore: number | null;
  blockersCount: number;
  healthStatus: string | null;
  status: VerdictStatus;
  lastReviewedCommit: string | null;
  generatedAt: string | null;
  /** The canonical evidence policy allows affirmative deployment language for this project's verdict. Absent = not affirmed. */
  affirmsDeploy?: boolean;
  /** Scan the persisted verdict belongs to (absent in snapshots cached before this field existed). */
  verdictScanId?: string | null;
  /** Absent = unknown (old cached snapshot); consumers must not read absence as "current" for affirmations. */
  verdictState?: BrainVerdictState;
};

export type ProductionRoadmapItem = {
  rank: number;
  title: string;
  description?: string;
  category: string;
  scoreDelta: number;
  estimatedMinutes: number;
};

export type ProductionRoadmap = {
  items: ProductionRoadmapItem[];
  currentScore: number | null;
  projectedScore: number | null;
  totalMinutes: number;
};

export type OrgBrainSnapshot = {
  organizationId: string;
  averageProductionReady: number | null;
  averageDimensions: ReadinessDimensions;
  totalBlockers: number;
  totalEstimatedMinutes: number;
  productionRoadmap: ProductionRoadmap;
  projects: ProjectBrainSummary[];
  todayPriorities: BrainPriority[];
  recentActivity: BrainActivityEvent[];
  snapshotAt: string;
  brainVersion: typeof BRAIN_VERSION;
};
