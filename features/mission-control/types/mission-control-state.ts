import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import type { SecurityTestContext } from "@/features/security-testing/types";
import type { ProtectionCenterSnapshot } from "@/features/continuous-protection/types";
import type { AnalysisRunListItem } from "@/server/analysis-runs/list-analysis-runs";
import type { MissionControlView } from "../types";

export type MissionControlPrimaryActionKind =
  | "copy_safe_fix"
  | "verify_protection"
  | "run_review_again"
  | "deploy"
  | "run_review"
  | "none";

export type MissionControlRecoveryReason =
  | "scoped_verdict_missing"
  | "manual_recovery"
  | null;

export type MissionControlScanButtonLabel = "cta" | "running" | "rescan" | "retry";

export type MissionControlSecurityButtonLabel = "cta" | "running";

/**
 * Current-scan-vs-previous-scan finding identity, computed by
 * server/security-scanner/finding-resolution.ts (backed by the deterministic
 * lib/correlation/scan-finding-resolution.ts diff). The frontend only
 * renders this — it never recomputes resolution itself.
 */
export type FindingResolutionSummary = {
  /** current ScanFinding.id -> resolution status, for findings still present this scan */
  statusByFindingId: Record<string, "new" | "unchanged" | "ambiguous">;
  /** findings present in the previous scan but absent from this one -- no "current" row exists for these */
  resolvedFindings: { correlationKey: string; title: string; filePath: string; severity?: string }[];
};

export type MissionControlState = {
  projectId: string;
  projectName: string;
  framework: string | null;

  analysisRunId: string | null;
  activeRun: AnalysisRunListItem | null;
  latestRun: AnalysisRunListItem | null;
  analysisRuns: AnalysisRunListItem[];
  runScoped: boolean;
  recoveryReason: MissionControlRecoveryReason;

  productionVerdict: ProductionVerdictV1 | null;
  view: MissionControlView;
  securityTestContext: SecurityTestContext | null;
  protectionCenter: ProtectionCenterSnapshot | null;

  /** Canonical status — every UI label derives from here. */
  status: {
    reviewInProgress: boolean;
    securityRunning: boolean;
    progress: number | null;
    progressMessage: string | null;
    lastAnalysisAt: string | null;
    hasCompletedAnalysis: boolean;
    hasVerdict: boolean;
    repositoryConnected: boolean;
    repositoryOutOfSync: boolean;
    currentCommitSha: string | null;
  };

  actions: {
    scan: {
      label: MissionControlScanButtonLabel;
      disabled: boolean;
      showSpinner: boolean;
    };
    security: {
      label: MissionControlSecurityButtonLabel;
      disabled: boolean;
      showSpinner: boolean;
    };
    primary: {
      kind: MissionControlPrimaryActionKind;
    };
  };

  flags: {
    analysisRunIsolationEnabled: boolean;
    attackCenterEnabled: boolean;
    continuousProtectionEnabled: boolean;
  };

  ui: {
    viewingHistoricalRun: boolean;
    showRecoveryBanner: boolean;
    showProtectionStatus: boolean;
    isVerdictStale: boolean;
    reportHref?: string;
    fixPromptContext?: FixPromptContext;
    findingResolution?: FindingResolutionSummary;
    /** "github" | "upload" -- how the scan behind the current verdict was ingested (Phase 10). */
    scanSource?: string;
    attackCenterHref?: string;
    openTechnicalDetails: boolean;
    showAnalysisRunSelector: boolean;
    showOnboardedBanner: boolean;
    showConnectedBanner: boolean;
    showReviewCompleteBanner: boolean;
  };
};

export type MissionControlStateResponse = MissionControlState & { ok: true };
