import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { getCurrentProductionVerdict, computeLiveProductionVerdict } from "@/server/production-verdict/service";
import { ReviewNowError, triggerProductionReview } from "@/server/review-now/trigger-review";
import { isMcpReviewRateLimited } from "@/server/review-now/rate-limit";
import { listAttackFindingsForExecutions } from "@/server/attack-simulation/persistence/finding-repository";
import { mapAttackFindingRow } from "@/server/attack-simulation/persistence/mappers";
import { attackFindingSchema } from "@/server/attack-simulation/contracts/attack-finding";
import { getAttackCampaignByScanId } from "@/server/attack-simulation/persistence/campaign-repository";
import {
  correlateAuditFindings,
  countAuditFindings,
  type AttackFindingInput,
  type StaticFindingInput,
} from "./correlate-findings";
import { enrichAuditFindingSolutions } from "./enrich-solutions";
import {
  buildWhatToFixFirstEntries,
  enrichAuditFindingUserFacing,
} from "./finding-user-copy";
import { pollUntilReviewTerminal } from "./poll";
import { ensureSecurityTestsForAudit } from "./run-security-tests";
import { resolveDynamicTargetForAudit } from "./resolve-dynamic-target";
import type { FullProductAuditResult } from "./types";
import type { DynamicVerificationDecision } from "./dynamic-verification-flow";

export class FullProductAuditError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "FullProductAuditError";
  }
}

export type RunFullProductAuditInput = {
  organizationId: string;
  projectId: string;
  projectName: string;
  repositoryFullName: string | null;
  githubRepo: string | null;
  githubRepositoryId: number | null;
  commitSha?: string;
  branch?: string;
  waitForReviewMs?: number;
  waitForSecurityTestsMs?: number;
  dynamicVerificationDecision?: DynamicVerificationDecision;
  reviewDeps?: import("@/server/review-now/trigger-review").TriggerReviewDependencies;
};

function buildRecommendation(input: {
  verdictStatus: VerdictStatus | null;
  topRisks: FullProductAuditResult["topRisks"];
  counts: FullProductAuditResult["counts"];
}): string {
  if (input.counts.confirmed > 0) {
    return "Do not deploy until confirmed vulnerabilities are fixed. Re-run Full Product Audit after applying fixes.";
  }
  if (input.verdictStatus === "ready_to_ship") {
    return "SequrAI found no confirmed dynamic vulnerabilities blocking deploy. Ship when your release process is ready.";
  }
  if (input.verdictStatus === "not_ready" || (input.counts.critical + input.counts.high) > 0) {
    return "Do not deploy until production blockers are resolved. Start with the top risk below.";
  }
  return "Address the top risks below, then run Full Product Audit again to verify.";
}

function buildWhatToFixFirst(topRisks: FullProductAuditResult["topRisks"]): string[] {
  return buildWhatToFixFirstEntries(topRisks);
}

export async function runFullProductAudit(
  admin: SupabaseClient,
  input: RunFullProductAuditInput
): Promise<FullProductAuditResult> {
  if (await isMcpReviewRateLimited(admin, input.organizationId)) {
    throw new FullProductAuditError("Rate limited", "rate_limited", 429);
  }

  let forceNewRun = false;
  if (input.dynamicVerificationDecision === "authorize") {
    const dynamicTarget = await resolveDynamicTargetForAudit(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
    const currentVerdict = await getCurrentProductionVerdict(admin, input.projectId);
    if (currentVerdict?.scanId) {
      const currentCampaign = await getAttackCampaignByScanId(
        admin,
        currentVerdict.scanId,
        input.organizationId
      );
      forceNewRun =
        currentCampaign != null &&
        (currentCampaign.runtimeMode !== "authorized_staging" ||
          !dynamicTarget.authorization ||
          currentCampaign.authorizationId !== dynamicTarget.authorization.id);
    }
  }

  let reviewOutcome;
  try {
    reviewOutcome = await triggerProductionReview(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      githubRepo: input.githubRepo,
      githubRepositoryId: input.githubRepositoryId,
      requestedCommitSha: input.commitSha,
      requestedBranch: input.branch,
      // Replace only an incompatible completed campaign. A fresh completed
      // review without a campaign should be reused for its authorized run.
      forceNewRun,
    }, input.reviewDeps);
  } catch (error) {
    if (error instanceof ReviewNowError) {
      throw new FullProductAuditError(error.message, error.code, 422);
    }
    throw error;
  }

  let scanId =
    reviewOutcome.outcome === "queued" || reviewOutcome.outcome === "processing"
      ? reviewOutcome.reviewId
      : reviewOutcome.reviewId;

  let reviewTimedOut = false;
  if (reviewOutcome.outcome === "queued" || reviewOutcome.outcome === "processing") {
    const poll = await pollUntilReviewTerminal(
      admin,
      { organizationId: input.organizationId, projectId: input.projectId },
      { maxMs: input.waitForReviewMs ?? 300_000 }
    );
    scanId = poll.scanId ?? scanId;
    reviewTimedOut = poll.timedOut;
    if (poll.status === "failed") {
      throw new FullProductAuditError("Production review failed", "review_failed", 422);
    }
  }

  if (!scanId) {
    throw new FullProductAuditError("No scan available after review", "review_failed", 422);
  }

  const { data: scanRow } = await admin
    .from("scans")
    .select("id, commit_sha, status, metrics")
    .eq("id", scanId)
    .maybeSingle();

  if (!scanRow || scanRow.status !== "completed") {
    return {
      mode: "full_product_audit",
      phase: reviewTimedOut ? "partial" : "review_running",
      project: {
        id: input.projectId,
        name: input.projectName,
        repositoryFullName: input.repositoryFullName,
      },
      reviewId: scanId,
      commitSha: (scanRow?.commit_sha as string | null) ?? null,
      verdictStatus: null,
      score: null,
      counts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
        confirmed: 0,
        likely: 0,
        potential: 0,
        notReproduced: 0,
        falsePositive: 0,
        notApplicable: 0,
      },
      topRisks: [],
      whatToFixFirst: [],
      findings: [],
      engines: {
        codeReview: { scanId, findingsCount: 0, rulesRun: null },
        securityTesting: {
          campaignId: null,
          executionsRun: 0,
          executionsCompleted: 0,
          adaptersExecuted: [],
          adaptersSelectedFromFindings: [],
          runtimeMode: null,
          dynamicTargetSource: null,
          skippedReason: "review_incomplete",
          notSafelyTestableCount: 0,
        },
      },
      dynamicVerification: {
        offered: false,
        decision: null,
        authorizedTarget: null,
        awaitingUrl: false,
        awaitingAuthorization: false,
        awaitingScopeApproval: false,
        notSafelyTestableCount: 0,
      },
      safeFixAvailable: false,
      safeFixBlockerId: null,
      recommendation: "SequrAI is still reviewing your application. Run Full Product Audit again shortly.",
      summary: "SEQURAI — FULL PRODUCT AUDIT\n\nProduction review still in progress.",
      timedOut: reviewTimedOut,
      nextAction: "Wait for the review to finish, then run Full Product Audit again.",
    };
  }

  const { data: scanJob } = await admin
    .from("scan_jobs")
    .select("id")
    .eq("scan_id", scanId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: staticRows } = await admin
    .from("scan_findings")
    .select(
      "id, rule_id, title, description, severity, category, file_path, start_line, recommendation, confidence, evidence, metadata"
    )
    .eq("scan_id", scanId);

  const staticFindings: StaticFindingInput[] = (staticRows ?? []).map((row) => ({
    id: row.id as string,
    ruleId: row.rule_id as string | null,
    title: row.title as string,
    description: row.description as string | null,
    severity: row.severity as string,
    category: row.category as string | null,
    filePath: row.file_path as string | null,
    startLine: row.start_line as number | null,
    recommendation: row.recommendation as string | null,
    confidence: row.confidence as string | null,
    evidence: row.evidence as string | null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }));

  const securityTests = await ensureSecurityTestsForAudit(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId,
    scanJobId: (scanJob?.id as string | null) ?? null,
    commitSha: (scanRow.commit_sha as string) ?? "unknown",
    waitForScanBootstrapMs: input.waitForSecurityTestsMs ?? 120_000,
    staticFindings,
    dynamicVerificationDecision: input.dynamicVerificationDecision,
    dynamicScopeExpansionApproved: input.dynamicVerificationDecision === "authorize",
  });

  const attackFindingsByExecution = await listAttackFindingsForExecutions(
    admin,
    securityTests.executionIds,
    input.organizationId
  );

  const attackFindings: AttackFindingInput[] =
    securityTests.executionIds.length > 0
      ? [...attackFindingsByExecution.values()].map((finding) => ({
          id: finding.id,
          title: finding.title,
          description: finding.description,
          severity: finding.severity,
          category: finding.category,
          outcome: finding.outcome,
          impact: finding.impact,
          adapterId:
            typeof finding.metadata?.adapterId === "string"
              ? finding.metadata.adapterId
              : null,
          confidence: finding.confidence,
        }))
      : securityTests.campaignId
        ? await listAllAttackFindingsForCampaign(
            admin,
            securityTests.campaignId,
            input.organizationId
          )
        : [];

  const persistedVerdict = await getCurrentProductionVerdict(admin, input.projectId);
  const liveVerdict = await computeLiveProductionVerdict(admin, {
    projectId: input.projectId,
    scan: scanRow as {
      id: string;
      commit_sha?: string | null;
      branch?: string | null;
      status?: string | null;
      security_score?: number | null;
      files_analyzed?: number | null;
      files_scanned?: number | null;
      files_discovered?: number | null;
      total_files?: number | null;
      repository_id?: string | null;
    },
    persisted: persistedVerdict,
  });
  const verdict = liveVerdict ?? persistedVerdict;
  const priorityFindingIds = verdict?.topPriorities.flatMap((priority) => priority.findingIds) ?? [];

  const consolidated = enrichAuditFindingUserFacing(
    enrichAuditFindingSolutions(
      correlateAuditFindings({
        staticFindings,
        attackFindings,
        executedAdapters: securityTests.adaptersExecuted,
        priorityFindingIds,
      })
    )
  );

  const counts = countAuditFindings(consolidated);
  const productionRisks = consolidated.filter(
    (finding) =>
      (finding.severity.toLowerCase() === "critical" || finding.severity.toLowerCase() === "high") &&
      !finding.userFacing?.safeToIgnore
  );
  const topRisks = (productionRisks.length > 0 ? productionRisks : consolidated).slice(0, 6);
  const whatToFixFirst = buildWhatToFixFirst(topRisks);
  const verdictStatus = (verdict?.status as VerdictStatus | null) ?? null;
  const score = verdict?.score ?? null;
  const safeFixBlockerId = verdict?.topPriorities[0]?.id ?? null;

  const metrics = (scanRow.metrics as Record<string, unknown> | null) ?? null;
  const rulesRun =
    typeof metrics?.rulesRun === "number"
      ? metrics.rulesRun
      : typeof metrics?.rules_run === "number"
        ? metrics.rules_run
        : null;

  const timedOut = reviewTimedOut || securityTests.timedOut;
  const phase = timedOut ? "partial" : "complete";
  const recommendation = buildRecommendation({ verdictStatus, topRisks, counts });

  let nextAction = safeFixBlockerId
    ? "Run safe_fix for the top blocker, apply the prompt, then run Full Product Audit again."
    : "Run Full Product Audit again after your next significant change.";

  if (securityTests.dynamicVerification.offered) {
    nextAction =
      'Say you want to "Autorizar y comprobar" or choose "Solo analizar el código" to continue.';
  } else if (securityTests.dynamicVerification.awaitingScopeApproval) {
    nextAction =
      'Authorize the security check update, then run Full Product Audit again with "Autorizar y comprobar".';
  } else if (securityTests.dynamicVerification.awaitingUrl) {
    nextAction = "Provide your deployed application URL, then authorize dynamic verification.";
  } else if (securityTests.skippedReason === "user_declined_dynamic") {
    nextAction = "Static analysis completed. Dynamic testing was not authorized.";
  }

  return {
    mode: "full_product_audit",
    phase,
    project: {
      id: input.projectId,
      name: input.projectName,
      repositoryFullName: input.repositoryFullName,
    },
    reviewId: scanId,
    commitSha: (scanRow.commit_sha as string | null) ?? null,
    verdictStatus,
    score: verdict?.score ?? null,
    counts,
    topRisks,
    whatToFixFirst,
    findings: consolidated,
    engines: {
      codeReview: {
        scanId,
        findingsCount: staticFindings.length,
        rulesRun,
      },
      securityTesting: {
        campaignId: securityTests.campaignId,
        executionsRun: securityTests.executionIds.length,
        executionsCompleted: securityTests.executionIds.length,
        adaptersExecuted: securityTests.adaptersExecuted,
        adaptersSelectedFromFindings: securityTests.adaptersSelectedFromFindings,
        runtimeMode: securityTests.runtimeMode,
        dynamicTargetSource: securityTests.dynamicTargetSource,
        skippedReason: securityTests.skippedReason,
        notSafelyTestableCount: securityTests.dynamicVerification.notSafelyTestableCount,
      },
    },
    dynamicVerification: securityTests.dynamicVerification,
    safeFixAvailable: Boolean(safeFixBlockerId),
    safeFixBlockerId,
    recommendation,
    summary: "",
    timedOut,
    nextAction,
  };
}

export async function listAllAttackFindingsForCampaign(
  admin: SupabaseClient,
  campaignId: string,
  organizationId: string
): Promise<AttackFindingInput[]> {
  const { data, error } = await admin
    .from("attack_simulation_findings")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => {
    const finding = attackFindingSchema.parse(mapAttackFindingRow(row));
    return {
      id: finding.id,
      title: finding.title,
      description: finding.description,
      severity: finding.severity,
      category: finding.category,
      outcome: finding.outcome,
      impact: finding.impact,
      adapterId:
        typeof finding.metadata?.adapterId === "string" ? finding.metadata.adapterId : null,
      confidence: finding.confidence,
    };
  });
}
