export type ScanJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ScanJobType =
  | "webhook_process"
  | "manual_scan"
  | "mcp_review"
  | "webhook_push_scan"
  | "webhook_pr_scan"
  | "automatic_review";

export type ScanRunPayload = {
  scanJobId: string;
  scanId: string;
  organizationId: string;
  projectId: string;
  userId: string;
  jobType?: ScanJobType;
  scanType?: "full" | "incremental";
  branch?: string;
  baseCommitSha?: string;
  headCommitSha?: string;
  correlationId?: string;
  persistMode?: "full" | "review_only";
  finalize?:
    | {
        kind: "webhook_automation";
        triggerLabel: string;
        statusSha?: string;
        appUrl?: string;
        incremental?: { baseSha: string; headSha: string };
      }
    | { kind: "webhook_pr"; pullRequestNumber: number; pullRequestTitle: string; baseBranch: string; headBranch: string; baseSha: string; headSha: string; scoreBefore: number | null; appUrl?: string }
    | { kind: "automatic_review" }
    | { kind: "incremental_record"; baseSha: string; headSha: string };
};

export type WebhookProcessPayload = {
  scanJobId: string;
  deliveryId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
};

export const SCAN_JOB_DEFAULT_MAX_ATTEMPTS = 3;
export const SCAN_JOB_TIMEOUT_MS = 15 * 60 * 1000;
export const SCAN_JOB_ORG_CONCURRENCY_LIMIT = 3;
