export type ReportType = "weekly" | "monthly";

export type FounderSummary = {
  moreProtectedThanPriorPeriod: boolean;
  moreProtectedNarrative: string;
  whatImproved: string[];
  whatWorriesSequrAI: string[];
  whatToDoNext: string;
  wouldDeployToday: string;
};

export type ProtectionReportData = {
  protectionStatus: {
    start: string | null;
    end: string | null;
    endLabel: string;
  };
  productionConfidence: {
    start: number | null;
    end: number | null;
    delta: number | null;
  };
  securityConfidence: {
    start: number | null;
    end: number | null;
    delta: number | null;
  };
  whatImproved: string[];
  whatBecameWorse: string[];
  openRecommendations: string[];
  topPriorities: string[];
  statistics: {
    dailyChecksCompleted: number;
    fullReviews: number;
    alertsImportant: number;
    unsafeDeploymentsPrevented: number;
    criticalIssuesFixed: number;
    safeFixesApplied: number;
    recommendationsCompleted: number;
    daysInPeriod: number;
  };
  milestones: string[];
  projectEvolution: string[];
  continuousProtectionOn: boolean;
};

export type StoredProtectionReport = {
  id: string;
  projectId: string;
  organizationId: string;
  reportType: ReportType;
  periodStart: string;
  periodEnd: string;
  version: number;
  isCurrent: boolean;
  dedupeKey: string;
  founderSummary: FounderSummary;
  reportData: ProtectionReportData;
  narrative: string;
  generatedAt: string;
  regeneratedAt: string | null;
};

export type TimelineEntry = {
  id?: string;
  occurredAt: string;
  episodeKind: "weekly_milestone" | "monthly_milestone" | "protection_improvement" | "confidence_change" | "important_event";
  periodKey: string;
  icon: string;
  titlePlain: string;
  subtitlePlain: string;
  payload?: Record<string, unknown>;
};
