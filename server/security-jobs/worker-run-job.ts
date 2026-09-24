import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { GitHubRepositoryService, parseGitHubRepository } from "@/lib/github/repository-service";
import { resolveOrganizationGitHubToken } from "@/server/github-automation/token-resolver";
import { listExternalAndNativeAdjacentEngines } from "@/server/security-engines/registry";
import { jobOutcomeFromEngineResult } from "./engine-result-status";
import { persistEngineResults } from "@/server/security-engines/persistence";
import type { EngineResult } from "@/server/security-engines/types";
import { transitionSecurityJob, recordJobEvent } from "./service";
import type { SecurityJob } from "./types";

/**
 * Phase 35.5: the worker's core "run one claimed job" loop. This is where
 * server/security-engines' already-real, already-proven engine execution
 * (Phase 35) meets the SecurityJob queue -- no engine execution logic is
 * duplicated here, only orchestration: fetch the repository (server-side,
 * using a server-resolved credential -- never a client-supplied token),
 * run the ONE requested engine, persist, emit events, transition state.
 */

export class JobCancelledError extends Error {
  constructor() {
    super("Security job was cancelled");
    this.name = "JobCancelledError";
  }
}

/**
 * Polls `cancel_requested` on an interval and rejects the race the moment
 * it becomes true -- this is how a long-running engine subprocess actually
 * gets interrupted (section 14: cancellation must propagate to the running
 * engine, not just flip a flag nobody reads).
 */
function raceCancellation<T>(admin: SupabaseClient, jobId: string, promise: Promise<T>): Promise<T> {
  let cancelled = false;
  const poll = setInterval(async () => {
    if (cancelled) return;
    const { data } = await admin.from("security_jobs").select("cancel_requested").eq("id", jobId).maybeSingle();
    if (data?.cancel_requested) cancelled = true;
  }, 1_000);

  return new Promise<T>((resolveRace, rejectRace) => {
    promise.then(
      (value) => {
        clearInterval(poll);
        resolveRace(value);
      },
      (error) => {
        clearInterval(poll);
        rejectRace(error);
      }
    );
    const cancelCheck = setInterval(() => {
      if (cancelled) {
        clearInterval(cancelCheck);
        clearInterval(poll);
        rejectRace(new JobCancelledError());
      }
    }, 250);
  });
}

async function loadJobContext(admin: SupabaseClient, job: SecurityJob) {
  const [{ data: scan }, { data: project }] = await Promise.all([
    admin.from("scans").select("commit_sha, branch").eq("id", job.scanId).maybeSingle(),
    admin
      .from("projects")
      .select("github_repo, github_repository_id")
      .eq("id", job.projectId)
      .eq("organization_id", job.organizationId)
      .maybeSingle(),
  ]);
  return {
    commitSha: (scan?.commit_sha as string | null) ?? undefined,
    branch: (scan?.branch as string | null) ?? undefined,
    githubRepo: (project?.github_repo as string | null) ?? null,
  };
}

export type RunClaimedJobOptions = {
  /**
   * When the caller already has the exact commit's files in memory (e.g.
   * the orchestrator's inline drain, which just fetched them to build the
   * application surface / plan), pass them here to skip this job's own
   * repository fetch entirely -- otherwise every engine job independently
   * re-downloads and re-extracts the same tarball from GitHub. A real
   * standalone worker process (worker-poll-loop.ts) has no such in-memory
   * copy and must keep fetching for itself, so this stays optional.
   */
  preFetchedFiles?: Array<{ path: string; content: string }>;
  /** Required alongside preFetchedFiles (no DB lookup is done to get it). */
  githubRepo?: string | null;
};

export type RunClaimedJobResult = {
  status: SecurityJob["status"];
  engineResult: EngineResult | null;
};

export async function runClaimedSecurityJob(
  admin: SupabaseClient,
  job: SecurityJob,
  options?: RunClaimedJobOptions
): Promise<RunClaimedJobResult> {
  await recordJobEvent(admin, {
    organizationId: job.organizationId,
    projectId: job.projectId,
    scanId: job.scanId,
    jobId: job.id,
    eventType: "JOB_CLAIMED",
    detail: { engine: job.engine, attempt: job.attempt },
  });

  const engine = listExternalAndNativeAdjacentEngines().find((e) => e.id === job.engine);
  if (!engine) {
    await transitionSecurityJob(admin, {
      jobId: job.id,
      from: "RUNNING",
      to: "FAILED",
      error: { code: "unknown_engine", message: `No engine registered for id "${job.engine}"` },
    });
    await recordJobEvent(admin, {
      organizationId: job.organizationId,
      projectId: job.projectId,
      scanId: job.scanId,
      jobId: job.id,
      eventType: "ENGINE_FAILED",
      detail: { reason: "unknown_engine" },
    });
    return { status: "FAILED", engineResult: null };
  }

  let files: Array<{ path: string; content: string }>;
  let githubRepo: string | null;

  if (options?.preFetchedFiles) {
    files = options.preFetchedFiles;
    githubRepo = options.githubRepo ?? null;
    if (!githubRepo) {
      await transitionSecurityJob(admin, {
        jobId: job.id,
        from: "RUNNING",
        to: "FAILED",
        error: { code: "no_repository", message: "Project has no connected GitHub repository" },
      });
      return { status: "FAILED", engineResult: null };
    }
  } else {
    const context = await loadJobContext(admin, job);
    githubRepo = context.githubRepo;
    if (!githubRepo) {
      await transitionSecurityJob(admin, {
        jobId: job.id,
        from: "RUNNING",
        to: "FAILED",
        error: { code: "no_repository", message: "Project has no connected GitHub repository" },
      });
      return { status: "FAILED", engineResult: null };
    }

    const tokenResult = await resolveOrganizationGitHubToken(admin, job.organizationId, job.projectId);
    if (!tokenResult) {
      await transitionSecurityJob(admin, {
        jobId: job.id,
        from: "RUNNING",
        to: "FAILED",
        error: { code: "no_github_token", message: "No organization member has a valid GitHub connection" },
      });
      return { status: "FAILED", engineResult: null };
    }

    const github = new GitHubRepositoryService(tokenResult.token);
    try {
      const ref = parseGitHubRepository(githubRepo);
      const snapshot = await github.fetchSnapshot(ref, { branch: context.branch, commitSha: context.commitSha });
      files = snapshot.files.map((f) => ({ path: f.path, content: f.content }));
    } catch (error) {
      await transitionSecurityJob(admin, {
        jobId: job.id,
        from: "RUNNING",
        to: "FAILED",
        error: { code: "repository_fetch_failed", message: error instanceof Error ? error.message : String(error) },
      });
      return { status: "FAILED", engineResult: null };
    } finally {
      github.dispose();
    }
  }

  await recordJobEvent(admin, {
    organizationId: job.organizationId,
    projectId: job.projectId,
    scanId: job.scanId,
    jobId: job.id,
    eventType: "ENGINE_STARTED",
    detail: { engine: job.engine, filesCount: files.length },
  });

  let engineResult: EngineResult;
  try {
    engineResult = await raceCancellation(
      admin,
      job.id,
      engine.execute({
        scanId: job.scanId,
        projectId: job.projectId,
        organizationId: job.organizationId,
        files,
        githubRepo,
        timeoutMs: job.timeoutMs,
      })
    );
  } catch (error) {
    if (error instanceof JobCancelledError) {
      await transitionSecurityJob(admin, { jobId: job.id, from: "RUNNING", to: "CANCELLED" });
      await recordJobEvent(admin, {
        organizationId: job.organizationId,
        projectId: job.projectId,
        scanId: job.scanId,
        jobId: job.id,
        eventType: "ENGINE_CANCELLED",
      });
      return { status: "CANCELLED", engineResult: null };
    }
    await transitionSecurityJob(admin, {
      jobId: job.id,
      from: "RUNNING",
      to: "FAILED",
      error: { code: "engine_crashed", message: error instanceof Error ? error.message : String(error) },
    });
    await recordJobEvent(admin, {
      organizationId: job.organizationId,
      projectId: job.projectId,
      scanId: job.scanId,
      jobId: job.id,
      eventType: "ENGINE_FAILED",
      detail: { reason: "engine_crashed" },
    });
    return { status: "FAILED", engineResult: null };
  }

  await recordJobEvent(admin, {
    organizationId: job.organizationId,
    projectId: job.projectId,
    scanId: job.scanId,
    jobId: job.id,
    eventType: engineResult.status === "COMPLETED" ? "ENGINE_COMPLETED" : "ENGINE_FAILED",
    detail: { status: engineResult.status, findingsCount: engineResult.findings.length, errorsCount: engineResult.errors.length },
  });

  await persistEngineResults(admin, {
    organizationId: job.organizationId,
    projectId: job.projectId,
    scanId: job.scanId,
    results: [engineResult],
  });
  await recordJobEvent(admin, {
    organizationId: job.organizationId,
    projectId: job.projectId,
    scanId: job.scanId,
    jobId: job.id,
    eventType: "EVIDENCE_PERSISTED",
    detail: { findingsCount: engineResult.findings.length },
  });

  // COMPLETED only for complete evidence. A PARTIAL engine result must never
  // become COMPLETED (see engine-result-status.ts).
  const outcome = jobOutcomeFromEngineResult(engineResult);

  await transitionSecurityJob(admin, {
    jobId: job.id,
    from: "RUNNING",
    to: outcome.status,
    error: outcome.error,
  });

  const finalStatus = outcome.status;
  return { status: finalStatus, engineResult };
}
