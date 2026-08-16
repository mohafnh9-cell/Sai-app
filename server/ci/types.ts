import "server-only";

import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { GitHubCheckConclusion } from "@/server/github-automation/github-check-run";
import { SEQURAI_CHECK_RUN_NAME } from "@/server/github-automation/github-check-run";

export type CiScanPhase =
  | "missing"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type CiEnforcementStatus = {
  ok: boolean;
  projectId: string;
  organizationId: string;
  commitSha: string;
  prNumber: number | null;
  baseSha: string | null;
  headSha: string | null;
  scanId: string | null;
  scanPhase: CiScanPhase;
  source: "github" | "pr" | "ci" | null;
  stale: boolean;
  productionVerdict: ProductionVerdictV1 | null;
  checkRun: {
    name: typeof SEQURAI_CHECK_RUN_NAME;
    conclusion: GitHubCheckConclusion;
    githubCheckRunId: number | null;
  };
  correlation: {
    ready: boolean;
    endpoint: string;
  };
  idempotencyKey: string;
  triggerSource: "ci";
};

export type CiEnsureScanResult =
  | {
      outcome: "reused" | "resumed" | "scheduled" | "awaiting_webhook";
      status: CiEnforcementStatus;
      message: string;
    }
  | {
      outcome: "failed";
      code: string;
      message: string;
      status?: CiEnforcementStatus;
    };
