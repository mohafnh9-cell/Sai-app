import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildRepositoryModel,
  toRepositoryModelSummary,
} from "@/brain/repository-model";
import { ANALYSIS_ENGINE_V2_VERSION } from "@/brain/prompts/analysis-engine-v2";
import { scanRepository as scanRepositoryFiles, scoreFindings } from "@/features/security-scanner";
import { stubNormalizedFile } from "@/features/security-scanner/normalization";
import type { Confidence, Finding as ScannerFinding, Severity } from "@/features/security-scanner";
import { buildFindingCorrelationKeyFromParts } from "@/lib/correlation/finding-identity";
import { generateAndPersistProductionVerdict } from "@/server/production-verdict/service";
import {
  assertScanContinues,
  ScanCancelledError,
} from "@/server/review-cancel/review-abort";
import {
  GitHubRepositoryService,
  GitHubServiceError,
  parseGitHubRepository,
} from "@/lib/github/repository-service";
import { commitsMatch } from "@/lib/repository-sync/commits-match";
import {
  mergeReviewPipelineMetadata,
  reviewPhaseProgressForScan,
} from "@/brain/review-engine/state-machine";

const ACTIVE_SCAN_UPDATE_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
] as const;

type ScanContext = {
  scanId: string;
  scanJobId?: string;
  repositoryId: string;
  organizationId: string;
  githubRepo: string;
  branch?: string;
  providerToken: string;
  scanType?: "full" | "incremental";
  baseCommitSha?: string;
  headCommitSha?: string;
  /** Automatic reviews store scan results without updating verdicts or project scores. */
  persistMode?: "full" | "review_only";
};

type Finding = {
  ruleId: string;
  fingerprint: string;
  correlationKey: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  confidence: string;
  location: { path: string; line: number; column?: number };
  evidence?: string;
  remediation: string;
  metadata?: Record<string, unknown>;
};

export interface ScanJobRunner {
  run(context: ScanContext): Promise<void>;
}

function logScan(level: "info" | "error" | "warn", event: string, fields: Record<string, unknown>) {
  const safe = { component: "scan-job-runner", event, ...fields };
  if (level === "error") console.error(safe);
  else if (level === "warn") console.warn(safe);
  else console.info(safe);
}

function fingerprint(repositoryId: string, finding: Finding) {
  return createHash("sha256")
    .update(
      [
        repositoryId,
        finding.ruleId,
        finding.location.path,
        finding.location.line,
        finding.fingerprint,
      ].join(":")
    )
    .digest("hex");
}

function impactForFinding(finding: Finding): string {
  if (finding.severity === "critical") {
    return "Exploitation could directly expose sensitive data, privileged credentials, or application control.";
  }
  if (finding.severity === "high") {
    return "Exploitation could enable unauthorized access, sensitive-data exposure, or significant integrity loss.";
  }
  if (finding.severity === "medium") {
    return "The issue may be exploitable when additional application or deployment conditions are present.";
  }
  if (finding.severity === "low") {
    return "This weakens defense in depth but does not demonstrate immediate compromise by itself.";
  }
  return "Informational observation; no direct vulnerability is demonstrated.";
}

function findingRow(
  context: ScanContext,
  finding: Finding
): Record<string, unknown> {
  const severity = finding.severity.toLowerCase();
  const category = finding.category.toLowerCase();
  return {
    scan_id: context.scanId,
    organization_id: context.organizationId,
    project_id: context.repositoryId,
    repository_id: context.repositoryId,
    rule_id: finding.ruleId,
    severity,
    category,
    confidence: finding.confidence,
    title: finding.title,
    description: finding.description,
    impact: impactForFinding(finding),
    recommendation: finding.remediation,
    file_path: finding.location.path,
    start_line: finding.location.line,
    end_line: null,
    // Never persist a possible credential value.
    code_snippet: category === "secrets" ? "[REDACTED]" : finding.evidence ?? null,
    evidence: finding.evidence ?? null,
    status: "open",
    fingerprint: fingerprint(context.repositoryId, finding),
    metadata: {
      column: finding.location.column,
      correlationKey: finding.correlationKey,
      correlationMaterial:
        typeof finding.metadata?.correlationMaterial === "string"
          ? finding.metadata.correlationMaterial
          : undefined,
      ...finding.metadata,
    },
  };
}

export class InlineScanJobRunner implements ScanJobRunner {
  constructor(private readonly supabase: SupabaseClient) {}

  private scanStartedAtMs: number | null = null;

  async run(context: ScanContext): Promise<void> {
    const started = Date.now();
    this.scanStartedAtMs = started;
    try {
      logScan("info", "scan_started", {
        scanId: context.scanId,
        repositoryId: context.repositoryId,
      });
      const accepted = await this.updateActiveScan(context.scanId, {
        status: "fetching_repository",
        progress: 5,
        progress_message: "fetchingRepository",
        started_at: new Date().toISOString(),
      });
      if (!accepted) {
        logScan("info", "scan_superseded", {
          scanId: context.scanId,
          repositoryId: context.repositoryId,
        });
        return;
      }

      const ref = parseGitHubRepository(context.githubRepo);
      const github = new GitHubRepositoryService(context.providerToken);
      const isIncremental =
        context.scanType === "incremental" &&
        Boolean(context.baseCommitSha && context.headCommitSha);

      const snapshot = isIncremental
        ? await github.fetchCompareSnapshot(
            ref,
            context.baseCommitSha!,
            context.headCommitSha!
          )
        : await github.fetchSnapshot(ref, {
            branch: context.branch,
            commitSha: context.headCommitSha,
          });

      if (
        context.headCommitSha &&
        !commitsMatch(snapshot.commitSha, context.headCommitSha)
      ) {
        throw new GitHubServiceError(
          "GITHUB_RESPONSE",
          `COMMIT_SNAPSHOT_MISMATCH: expected ${context.headCommitSha}, got ${snapshot.commitSha}`,
          409
        );
      }

      logScan("info", "repository_fetched", {
        scanId: context.scanId,
        repositoryId: context.repositoryId,
        filesDiscovered: snapshot.discoveredFiles,
        filesSelected: snapshot.files.length,
        omittedFiles: snapshot.omissions.length,
        scanType: isIncremental ? "incremental" : "full",
      });

      await assertScanContinues(this.supabase, context.scanId);

      await Promise.all([
        this.updateScan(context.scanId, {
          status: "indexing",
          progress: 45,
          progress_message: "analyzingFiles",
          branch: context.branch ?? snapshot.defaultBranch,
          commit_sha: snapshot.commitSha,
          files_discovered: snapshot.discoveredFiles,
          files_analyzed: snapshot.files.length,
          metrics: {
            fetchedBytes: snapshot.totalBytes,
            requestedCommitSha: context.headCommitSha ?? null,
            resolvedSnapshotSha: snapshot.commitSha,
            analyzedCommitSha: snapshot.commitSha,
          },
          omissions: snapshot.omissions,
        }),
        this.supabase
          .from("projects")
          .update({
            github_repository_id: snapshot.repositoryId,
            github_default_branch: snapshot.defaultBranch,
            github_last_commit_sha: snapshot.commitSha,
            github_is_private: snapshot.isPrivate,
            github_connected_at: new Date().toISOString(),
          })
          .eq("id", context.repositoryId)
          .eq("organization_id", context.organizationId),
      ]);

      // Intentionally calls only the scanner's public, data-only API. Files are
      // treated as text; repository code is never imported or executed.
      await this.updateScan(context.scanId, {
        status: "scanning",
        progress: 60,
        progress_message: isIncremental
          ? "runningIncrementalRules"
          : "runningRules",
      });

      if (isIncremental && snapshot.files.length === 0) {
        const previousScore = await this.loadPreviousScore(context);
        await this.completeEmptyIncremental(context, snapshot, previousScore);
        return;
      }

      const result = await scanRepositoryFiles(snapshot.files);
      const repositoryModel = buildRepositoryModel(
        snapshot.files.map((file) => stubNormalizedFile(file.path, file.content)),
        result.stack
      );
      let rows = result.findings.map((finding) => findingRow(context, finding));
      let scoreBreakdown = result.score;
      let stack = result.stack;
      let metrics = {
        ...result.metrics,
        changedPaths: snapshot.changedPaths ?? [],
        scanType: isIncremental ? "incremental" : "full",
        repositoryModel: toRepositoryModelSummary(repositoryModel),
        analysisEngineVersion: ANALYSIS_ENGINE_V2_VERSION,
      } as Record<string, unknown>;

      if (isIncremental && snapshot.changedPaths?.length) {
        const merged = await this.mergeIncrementalFindings(
          context,
          snapshot.changedPaths,
          result.findings
        );
        rows = merged.rows;
        scoreBreakdown = scoreFindings(
          merged.findings.map((finding, index) => ({
            id: `merged-${index}`,
            ruleId: finding.ruleId,
            fingerprint: finding.fingerprint,
            correlationKey: finding.correlationKey,
            severity: finding.severity as Severity,
            confidence: finding.confidence as Confidence,
            category: finding.category,
            title: finding.title,
            description: finding.description,
            location: finding.location,
            evidence: finding.evidence,
            remediation: finding.remediation,
            metadata: finding.metadata as Record<string, string | number | boolean> | undefined,
          })) satisfies ScannerFinding[]
        );
        metrics = {
          ...metrics,
          mergedFindings: merged.findings.length,
          incrementalFindings: result.findings.length,
        };
      }
      logScan("info", "rules_completed", {
        scanId: context.scanId,
        rulesRun: result.metrics.rulesRun,
        ruleFailures: result.metrics.ruleFailures,
        findings: rows.length,
        durationMs: result.metrics.durationMs,
        scanType: isIncremental ? "incremental" : "full",
      });

      if (rows.length > 0) {
        const { error } = await this.supabase.from("scan_findings").insert(rows);
        if (error) throw new Error(`Could not persist scan findings: ${error.message}`);
      }

      await this.updateScan(context.scanId, {
        status: "calculating_score",
        progress: 90,
        progress_message: "calculatingScore",
      });
      const completedAt = new Date().toISOString();
      const score = Math.max(0, Math.min(100, Math.round(scoreBreakdown.score)));
      const counts = scoreBreakdown.counts;
      const priorCoverage = isIncremental ? await this.loadPreviousScanCoverage(context) : null;
      const incrementalFilesAnalyzed = snapshot.files.length;
      const filesAnalyzed = isIncremental
        ? Math.max(priorCoverage?.filesAnalyzed ?? 0, incrementalFilesAnalyzed)
        : result.metrics.scannedFiles;
      const filesDiscovered = isIncremental
        ? Math.max(priorCoverage?.filesDiscovered ?? 0, snapshot.discoveredFiles, filesAnalyzed)
        : result.metrics.scannedFiles;
      const completed = await this.updateActiveScan(context.scanId, {
        status: "completed",
        progress: 100,
        progress_message: isIncremental ? "incrementalCompleted" : "completed",
        security_score: score,
        score_breakdown: scoreBreakdown,
        metrics,
        detected_stack: stack,
        omissions: [...snapshot.omissions, ...(result.omissions ?? [])],
        summary: `${counts.critical + counts.high} blocker${counts.critical + counts.high === 1 ? "" : "s"} · ${counts.medium + counts.low} improvement${counts.medium + counts.low === 1 ? "" : "s"}.`,
        files_analyzed: filesAnalyzed,
        files_discovered: filesDiscovered,
        findings_count: rows.length,
        critical_count: counts.critical,
        high_count: counts.high,
        medium_count: counts.medium,
        low_count: counts.low,
        info_count: counts.info,
        completed_at: completedAt,
      });
      if (!completed) {
        logScan("info", "scan_superseded_before_complete", {
          scanId: context.scanId,
          repositoryId: context.repositoryId,
        });
        return;
      }

      const reviewOnly = context.persistMode === "review_only";

      if (!reviewOnly) {
        await this.supabase
          .from("projects")
          .update({ security_score: score, last_scan_at: completedAt })
          .eq("id", context.repositoryId)
          .eq("organization_id", context.organizationId);
      }

      await this.updateState(context, {
        active_scan_id: null,
        last_scan_id: context.scanId,
        last_commit_sha: snapshot.commitSha,
        ...(isIncremental || reviewOnly ? {} : { last_full_scan_at: completedAt }),
        ...(reviewOnly ? {} : { last_security_score: score, open_findings_count: rows.length }),
      });

      if (!reviewOnly) {
        await assertScanContinues(this.supabase, context.scanId);
        let securityDecisionReport: import("@/server/ai-red-team/decision/decision-model").SecurityDecisionReport | null =
          null;
        if (context.scanJobId) {
          logScan("info", "platform_convergence_started", {
            scanId: context.scanId,
            scanJobId: context.scanJobId,
            correlationId: context.scanId,
            executionId: context.scanJobId,
          });
          try {
            const { executeUnifiedScanRedTeamPhase } = await import(
              "@/server/platform-convergence/execute-unified-scan-pipeline"
            );
            const unified = await executeUnifiedScanRedTeamPhase(this.supabase, {
              scanId: context.scanId,
              scanJobId: context.scanJobId,
              organizationId: context.organizationId,
              projectId: context.repositoryId,
              commitSha: snapshot.commitSha,
              files: snapshot.files,
            });
            securityDecisionReport = unified.redTeam.securityDecision;
            logScan("info", "platform_convergence_completed", {
              scanId: context.scanId,
              scanJobId: context.scanJobId,
              status: unified.redTeam.status,
              durationMs: unified.redTeam.durationMs,
            });
          } catch (error) {
            logScan("error", "platform_convergence_failed", {
              scanId: context.scanId,
              scanJobId: context.scanJobId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          logScan("warn", "platform_convergence_skipped_no_scan_job", {
            scanId: context.scanId,
            repositoryId: context.repositoryId,
            persistMode: context.persistMode,
          });
        }

        try {
          await assertScanContinues(this.supabase, context.scanId);
          const verdict = await generateAndPersistProductionVerdict(this.supabase, {
            organizationId: context.organizationId,
            projectId: context.repositoryId,
            scanId: context.scanId,
            scanJobId: context.scanJobId,
            securityDecisionReport,
          });
          if (!verdict) {
            throw new Error(`VERDICT_NOT_PERSISTED: scan=${context.scanId}`);
          }
        } catch (error) {
          await this.updateScan(context.scanId, {
            status: "failed",
            progress_message: "verdictSaveFailed",
            error_code: "VERDICT_PERSISTENCE_FAILED",
            error_message:
              error instanceof Error ? error.message : "Production Verdict persistence failed",
            failed_at: new Date().toISOString(),
          }).catch(() => undefined);
          await this.updateState(context, { active_scan_id: null }).catch(() => undefined);
          throw error;
        }
      }
      logScan("info", "scan_completed", {
        scanId: context.scanId,
        repositoryId: context.repositoryId,
        files: snapshot.files.length,
        findings: rows.length,
        durationMs: Date.now() - started,
      });

      try {
        const { appendMissionFeedEvent } = await import("@/server/mission-control/get-mission-control");
        await appendMissionFeedEvent(this.supabase, {
          organizationId: context.organizationId,
          projectId: context.repositoryId,
          scanId: context.scanId,
          message: "Production review completed.",
        });
      } catch {
        // Feed writes are best-effort and must not fail the scan pipeline.
      }
    } catch (error) {
      if (error instanceof ScanCancelledError) {
        logScan("info", "scan_aborted_cancelled", {
          scanId: context.scanId,
          repositoryId: context.repositoryId,
        });
        return;
      }
      const code = error instanceof GitHubServiceError ? error.code : "SCAN_FAILED";
      const message =
        error instanceof GitHubServiceError
          ? error.message
          : "The scan could not be completed";
      await this.updateScan(context.scanId, {
        status: "failed",
        progress_message: "failed",
        error_code: code,
        error_message: message,
        failed_at: new Date().toISOString(),
      }).catch(() => undefined);
      await this.updateState(context, {
        active_scan_id: null,
      }).catch(() => undefined);
      logScan("error", "scan_failed", {
        scanId: context.scanId,
        repositoryId: context.repositoryId,
        code,
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }

  private async loadPreviousScanCoverage(
    context: ScanContext
  ): Promise<{ filesAnalyzed: number; filesDiscovered: number } | null> {
    const { data: rows } = await this.supabase
      .from("scans")
      .select("files_analyzed, files_discovered")
      .eq("repository_id", context.repositoryId)
      .eq("status", "completed")
      .neq("id", context.scanId)
      .order("completed_at", { ascending: false })
      .limit(8);

    const data = (rows ?? []).find((row) => ((row.files_analyzed as number | null) ?? 0) >= 3) ?? null;
    if (!data) return null;

    const filesAnalyzed = (data.files_analyzed as number | null) ?? 0;
    const filesDiscovered = (data.files_discovered as number | null) ?? 0;
    if (filesAnalyzed < 3) return null;

    return {
      filesAnalyzed,
      filesDiscovered: Math.max(filesDiscovered, filesAnalyzed),
    };
  }

  private async loadPreviousScore(context: ScanContext): Promise<number | null> {
    const { data } = await this.supabase
      .from("repository_scan_state")
      .select("last_security_score")
      .eq("repository_id", context.repositoryId)
      .maybeSingle();
    return data?.last_security_score ?? null;
  }

  private async mergeIncrementalFindings(
    context: ScanContext,
    changedPaths: string[],
    newFindings: Array<{
      ruleId: string;
      fingerprint: string;
      correlationKey: string;
      severity: string;
      category: string;
      title: string;
      description: string;
      confidence: string;
      location: { path: string; line: number; column?: number };
      evidence?: string;
      remediation: string;
      metadata?: Record<string, unknown>;
    }>
  ) {
    const changedSet = new Set(changedPaths);
    const { data: lastScan } = await this.supabase
      .from("scans")
      .select("id")
      .eq("repository_id", context.repositoryId)
      .eq("status", "completed")
      .neq("id", context.scanId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let retained: typeof newFindings = [];
    if (lastScan?.id) {
      const { data: previousRows } = await this.supabase
        .from("scan_findings")
        .select(
          "rule_id, severity, category, title, description, confidence, file_path, start_line, evidence, recommendation, metadata, fingerprint"
        )
        .eq("scan_id", lastScan.id)
        .eq("status", "open");

      retained =
        previousRows
          ?.filter((row) => !changedSet.has(row.file_path))
          .map((row) => ({
            ruleId: row.rule_id,
            fingerprint: row.fingerprint,
            correlationKey: buildFindingCorrelationKeyFromParts({
              ruleId: row.rule_id,
              filePath: row.file_path,
              title: row.title,
              metadata: (row.metadata as Record<string, unknown> | null) ?? null,
            }),
            severity: row.severity,
            category: row.category,
            title: row.title,
            description: row.description,
            confidence: row.confidence,
            location: { path: row.file_path, line: row.start_line },
            evidence: row.evidence ?? undefined,
            remediation: row.recommendation,
            metadata: (row.metadata as Record<string, unknown>) ?? undefined,
          })) ?? [];
    }

    const mergedFindings = [...retained, ...newFindings];
    const rows = mergedFindings.map((finding) => findingRow(context, finding));
    return { findings: mergedFindings, rows };
  }

  private async completeEmptyIncremental(
    context: ScanContext,
    snapshot: {
      commitSha: string;
      discoveredFiles: number;
      omissions: Array<{ path?: string; reason: string; count?: number }>;
      changedPaths?: string[];
      defaultBranch: string;
    },
    previousScore: number | null
  ) {
    const score = previousScore ?? 100;
    const completedAt = new Date().toISOString();
    const priorCoverage = await this.loadPreviousScanCoverage(context);
    const merged = await this.mergeIncrementalFindings(context, [], []);
    if (merged.rows.length > 0) {
      const { error } = await this.supabase.from("scan_findings").insert(merged.rows);
      if (error) throw new Error(`Could not persist retained scan findings: ${error.message}`);
    }
    const filesAnalyzed = priorCoverage
      ? Math.max(priorCoverage.filesAnalyzed, snapshot.discoveredFiles)
      : snapshot.discoveredFiles;
    const filesDiscovered = Math.max(
      priorCoverage?.filesDiscovered ?? 0,
      snapshot.discoveredFiles,
      filesAnalyzed
    );
    await this.updateScan(context.scanId, {
      status: "completed",
      progress: 100,
      progress_message: "noChanges",
      security_score: score,
      metrics: { scanType: "incremental", changedPaths: snapshot.changedPaths ?? [] },
      summary: "Incremental scan completed with no scannable file changes.",
      files_discovered: filesDiscovered,
      files_analyzed: filesAnalyzed,
      findings_count: merged.rows.length,
      completed_at: completedAt,
      branch: context.branch ?? snapshot.defaultBranch,
      commit_sha: snapshot.commitSha,
      omissions: snapshot.omissions,
    });
    await this.supabase
      .from("projects")
      .update({ security_score: score, last_scan_at: completedAt })
      .eq("id", context.repositoryId)
      .eq("organization_id", context.organizationId);
    await this.updateState(context, {
      active_scan_id: null,
      last_scan_id: context.scanId,
      last_commit_sha: snapshot.commitSha,
      last_security_score: score,
    });

    if (context.persistMode !== "review_only" && context.scanJobId) {
      let securityDecisionReport: import("@/server/ai-red-team/decision/decision-model").SecurityDecisionReport | null =
        null;
      try {
        await assertScanContinues(this.supabase, context.scanId);
        const { executeUnifiedScanRedTeamPhase } = await import(
          "@/server/platform-convergence/execute-unified-scan-pipeline"
        );
        const unified = await executeUnifiedScanRedTeamPhase(this.supabase, {
          scanId: context.scanId,
          scanJobId: context.scanJobId,
          organizationId: context.organizationId,
          projectId: context.repositoryId,
          commitSha: snapshot.commitSha,
          files: "files" in snapshot && Array.isArray(snapshot.files) ? snapshot.files : [],
        });
        securityDecisionReport = unified.redTeam.securityDecision;
      } catch (error) {
        if (error instanceof ScanCancelledError) return;
        // verdict path may still run without red team
      }
      await assertScanContinues(this.supabase, context.scanId);
      await generateAndPersistProductionVerdict(this.supabase, {
        organizationId: context.organizationId,
        projectId: context.repositoryId,
        scanId: context.scanId,
        scanJobId: context.scanJobId,
        securityDecisionReport,
      });
    } else if (context.persistMode !== "review_only") {
      await assertScanContinues(this.supabase, context.scanId);
      await generateAndPersistProductionVerdict(this.supabase, {
        organizationId: context.organizationId,
        projectId: context.repositoryId,
        scanId: context.scanId,
        scanJobId: context.scanJobId ?? null,
      });
    }
  }

  private async updateActiveScan(scanId: string, values: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("scans")
      .update(values)
      .eq("id", scanId)
      .in("status", [...ACTIVE_SCAN_UPDATE_STATUSES])
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Could not update scan: ${error.message}`);
    return Boolean(data);
  }

  private async updateScan(scanId: string, values: Record<string, unknown>) {
    const enriched = this.withReviewPipeline(values);
    const updated = await this.updateActiveScan(scanId, enriched);
    if (!updated) {
      logScan("info", "scan_update_superseded", { scanId });
    }
    return updated;
  }

  private withReviewPipeline(values: Record<string, unknown>): Record<string, unknown> {
    const status = values.status;
    if (typeof status !== "string") return values;

    const progress = reviewPhaseProgressForScan({
      scanStatus: status,
      progress: typeof values.progress === "number" ? values.progress : null,
      message: typeof values.progress_message === "string" ? values.progress_message : null,
      startedAtMs: this.scanStartedAtMs,
    });

    const metrics =
      values.metrics && typeof values.metrics === "object" && !Array.isArray(values.metrics)
        ? (values.metrics as Record<string, unknown>)
        : {};

    return {
      ...values,
      metrics: mergeReviewPipelineMetadata(metrics, {
        phase: progress.phase,
        percentage: progress.percentage,
        message: progress.message,
        log: `${progress.phase}: ${progress.message}`,
      }),
    };
  }

  private async updateState(context: ScanContext, values: Record<string, unknown>) {
    const { error } = await this.supabase.from("repository_scan_state").upsert(
      {
        repository_id: context.repositoryId,
        organization_id: context.organizationId,
        ...values,
      },
      { onConflict: "repository_id" }
    );
    if (error) throw new Error(`Could not update repository scan state: ${error.message}`);
  }
}
