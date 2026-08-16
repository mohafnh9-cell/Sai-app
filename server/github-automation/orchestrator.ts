import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  postGitHubCommitStatus,
} from "./github-status";
import {
  buildCheckRunExternalId,
  postPendingGitHubCheckRun,
} from "./github-check-run";
import { resolveOrganizationGitHubToken } from "./token-resolver";
import {
  branchFromRef,
  type GitHubPullRequestPayload,
  type GitHubPushPayload,
  type GitHubRepositoryPayload,
} from "./webhook-utils";
import { recordRepositoryActivity } from "./activity";
import { REPOSITORY_SYNC_CONFIG, parsePushDetection } from "@/brain/repository-sync";
import { AUTOMATIC_REVIEW_CONFIG } from "@/brain/automatic-review";
import {
  markRepositorySyncError,
  recordPushDetection,
  touchWebhookLastDelivery,
} from "@/server/repository-sync";
import { runAutomaticProductionReview } from "@/server/automatic-review";
import { isVerdictAutopilotEnabled } from "@/server/autopilot";
import {
  isDeliveryAlreadyHandled,
} from "./delivery-idempotency";
import { scheduleAutomationScan } from "@/server/jobs/schedule-scan";
import type { ScanRunPayload } from "@/server/jobs/types";

type ProjectRow = {
  id: string;
  organization_id: string;
  name: string;
  github_repo: string | null;
  github_repository_id: number | null;
  webhook_enabled: boolean | null;
  security_score: number | null;
};

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "github-automation", event, ...fields });
}

async function findProjectsByRepositoryId(
  admin: SupabaseClient,
  repositoryId: number
): Promise<ProjectRow[]> {
  const { data } = await admin
    .from("projects")
    .select("id, organization_id, name, github_repo, github_repository_id, webhook_enabled, security_score")
    .eq("github_repository_id", repositoryId);
  return (data as ProjectRow[] | null) ?? [];
}

async function recordEvent(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    deliveryId: string | null;
    eventType: string;
    action?: string;
    branch?: string;
    commitSha?: string;
    baseCommitSha?: string;
    pullRequestNumber?: number;
    payload: Record<string, unknown>;
    status: string;
    errorMessage?: string;
  }
) {
  const { error } = await admin.from("repository_events").upsert(
    {
      organization_id: input.organizationId,
      project_id: input.projectId,
      github_delivery_id: input.deliveryId,
      event_type: input.eventType,
      action: input.action ?? null,
      branch: input.branch ?? null,
      commit_sha: input.commitSha ?? null,
      base_commit_sha: input.baseCommitSha ?? null,
      pull_request_number: input.pullRequestNumber ?? null,
      payload: input.payload,
      status: input.status,
      error_message: input.errorMessage ?? null,
      processed_at: input.status === "processed" ? new Date().toISOString() : null,
    },
    { onConflict: "github_delivery_id", ignoreDuplicates: false }
  );
  if (error && error.code !== "23505") {
    console.warn("repository_event_upsert_failed", { message: error.message });
  }
}

async function createAutomationScan(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    userId: string;
    scanType: "incremental" | "full";
    branch?: string;
    commitSha?: string;
    triggerType?: "webhook" | "scheduled";
  }
) {
  const { data: active } = await admin
    .from("scans")
    .select("id")
    .eq("repository_id", input.projectId)
    .in("status", [
      "queued",
      "fetching_repository",
      "indexing",
      "scanning",
      "calculating_score",
    ])
    .limit(1)
    .maybeSingle();
  if (active) return null;

  const { data: scan, error } = await admin
    .from("scans")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      repository_id: input.projectId,
      triggered_by_user_id: input.userId,
      trigger_type: input.triggerType ?? "webhook",
      scan_type: input.scanType,
      status: "queued",
      progress: 0,
      progress_message: "githubQueued",
      branch: input.branch ?? null,
      commit_sha: input.commitSha ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return null;
    throw new Error(`Could not create automation scan: ${error.message}`);
  }

  await admin.from("repository_scan_state").upsert(
    {
      repository_id: input.projectId,
      organization_id: input.organizationId,
      active_scan_id: scan.id,
    },
    { onConflict: "repository_id" }
  );

  return scan.id;
}

async function enqueueAutomationScan(
  admin: SupabaseClient,
  input: {
    scanId: string;
    project: ProjectRow;
    userId: string;
    branch?: string;
    scanType: "incremental" | "full";
    baseCommitSha?: string;
    headCommitSha?: string;
    triggerLabel: string;
    statusSha?: string;
    appUrl?: string;
    jobType: "webhook_push_scan" | "webhook_pr_scan";
    finalize: ScanRunPayload["finalize"];
  }
) {
  await scheduleAutomationScan(admin, {
    scanJobId: "",
    scanId: input.scanId,
    organizationId: input.project.organization_id,
    projectId: input.project.id,
    userId: input.userId,
    scanType: input.scanType,
    branch: input.branch,
    baseCommitSha: input.baseCommitSha,
    headCommitSha: input.headCommitSha,
    jobType: input.jobType,
    finalize: input.finalize,
  });
}

export async function processGitHubWebhookEvent(input: {
  eventType: string;
  deliveryId: string | null;
  payload: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { eventType, deliveryId, payload } = input;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (eventType === "ping") {
    return { ok: true, action: "ping" };
  }

  const repository = payload.repository as { id?: number } | undefined;
  if (!repository?.id) {
    return { ok: true, action: "ignored", reason: "no_repository" };
  }

  const projects = await findProjectsByRepositoryId(admin, repository.id);
  if (!projects.length) {
    return { ok: true, action: "ignored", reason: "project_not_linked" };
  }

  const results = [];
  for (const project of projects) {
    if (!project.github_repo) continue;
    if (project.webhook_enabled === false) {
      results.push({ projectId: project.id, ok: true, action: "ignored", reason: "webhook_disabled" });
      continue;
    }

    const tokenResult = await resolveOrganizationGitHubToken(
      admin,
      project.organization_id,
      project.id
    );
    if (!tokenResult) {
      await recordEvent(admin, {
        organizationId: project.organization_id,
        projectId: project.id,
        deliveryId,
        eventType,
        payload,
        status: "failed",
        errorMessage: "No GitHub token available for workspace",
      });
      await markRepositorySyncError(admin, {
        organizationId: project.organization_id,
        projectId: project.id,
        githubRepositoryId: project.github_repository_id,
        errorCode: "invalid_github_connection",
      });
      results.push({ projectId: project.id, ok: false, action: "failed", reason: "no_token" });
      continue;
    }

    try {
      if (eventType === "push") {
        results.push(
          await handlePushEvent(admin, {
            project,
            deliveryId,
            payload: payload as unknown as GitHubPushPayload,
            token: tokenResult.token,
            userId: tokenResult.userId,
            appUrl,
          })
        );
        continue;
      }
      if (eventType === "pull_request") {
        results.push(
          await handlePullRequestEvent(admin, {
            project,
            deliveryId,
            payload: payload as unknown as GitHubPullRequestPayload,
            token: tokenResult.token,
            userId: tokenResult.userId,
            appUrl,
          })
        );
        continue;
      }
      if (eventType === "repository") {
        results.push(
          await handleRepositoryEvent(admin, {
            project,
            deliveryId,
            payload: payload as unknown as GitHubRepositoryPayload,
            eventType,
          })
        );
        continue;
      }
      if (eventType === "delete") {
        results.push(
          await handleBranchDelete(admin, {
            project,
            deliveryId,
            payload,
            eventType,
          })
        );
        continue;
      }

      await recordEvent(admin, {
        organizationId: project.organization_id,
        projectId: project.id,
        deliveryId,
        eventType,
        payload,
        status: "ignored",
      });
      results.push({ projectId: project.id, ok: true, action: "ignored", reason: "unsupported_event" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Processing failed";
      await recordEvent(admin, {
        organizationId: project.organization_id,
        projectId: project.id,
        deliveryId,
        eventType,
        payload,
        status: "failed",
        errorMessage: message,
      });
      log("event_failed", { eventType, projectId: project.id, message });
      results.push({ projectId: project.id, ok: false, action: "failed", reason: message });
    }
  }

  return { ok: true, action: "processed", results };
}

async function handlePushEvent(
  admin: SupabaseClient,
  input: {
    project: ProjectRow;
    deliveryId: string | null;
    payload: GitHubPushPayload;
    token: string;
    userId: string;
    appUrl?: string;
  }
) {
  const parsed = parsePushDetection(input.payload);

  if (!parsed) {
    const branch = branchFromRef(input.payload.ref);
    await recordEvent(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      deliveryId: input.deliveryId,
      eventType: "push",
      branch: branch ?? undefined,
      commitSha: input.payload.after,
      payload: input.payload as unknown as Record<string, unknown>,
      status: "ignored",
    });
    return { ok: true, action: "ignored", reason: "branch_delete_or_invalid" };
  }

  if (await isDeliveryAlreadyHandled(admin, input.deliveryId)) {
    log("duplicate_delivery", {
      projectId: input.project.id,
      deliveryId: input.deliveryId,
      commitSha: parsed.commitSha,
    });
    return { ok: true, action: "ignored", reason: "duplicate_delivery" };
  }

  await recordEvent(admin, {
    organizationId: input.project.organization_id,
    projectId: input.project.id,
    deliveryId: input.deliveryId,
    eventType: "push",
    branch: parsed.branch,
    commitSha: parsed.commitSha,
    baseCommitSha: input.payload.before,
    payload: input.payload as unknown as Record<string, unknown>,
    status: "processing",
  });

  try {
    await recordPushDetection(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      githubRepositoryId: input.project.github_repository_id,
      detection: parsed,
    });
    await touchWebhookLastDelivery(admin, input.project.id);

    let outcome:
      | { ok: boolean; action: string; reason?: string; [key: string]: unknown };

    if (REPOSITORY_SYNC_CONFIG.pushTriggersScan) {
      outcome = await handlePushEventWithScan(admin, input, parsed);
    } else if (AUTOMATIC_REVIEW_CONFIG.enabled) {
      const autopilotEnabled = await isVerdictAutopilotEnabled(
        admin,
        input.project.organization_id
      );

      if (!autopilotEnabled) {
        log("autopilot_disabled", { projectId: input.project.id });
        outcome = {
          ok: true,
          action: "change_detected",
          branch: parsed.branch,
          commitSha: parsed.commitSha,
          reason: "autopilot_disabled",
        };
      } else {
        const reviewResult = await runAutomaticProductionReview(admin, {
          project: input.project,
          detection: parsed,
          token: input.token,
          userId: input.userId,
        });

        log("automatic_review", {
          projectId: input.project.id,
          branch: parsed.branch,
          commitSha: parsed.commitSha,
          action: reviewResult.action,
        });

        outcome = {
          ok: reviewResult.ok,
          action: reviewResult.action,
          branch: parsed.branch,
          commitSha: parsed.commitSha,
          ...(reviewResult.action === "automatic_review_started"
            ? {
                scanId: reviewResult.scanId,
                reviewStatus: reviewResult.status,
                verdictUpdated: reviewResult.verdictUpdated,
              }
            : {}),
          ...(reviewResult.action === "automatic_review_skipped"
            ? { reason: reviewResult.reason }
            : {}),
          ...(reviewResult.action === "automatic_review_failed"
            ? { reason: reviewResult.reason }
            : {}),
        };
      }
    } else {
      log("change_detected", {
        projectId: input.project.id,
        branch: parsed.branch,
        commitSha: parsed.commitSha,
      });

      outcome = {
        ok: true,
        action: "change_detected",
        branch: parsed.branch,
        commitSha: parsed.commitSha,
      };
    }

    const eventStatus =
      outcome.ok === false ||
      outcome.action === "automatic_review_failed"
        ? "failed"
        : "processed";

    await recordEvent(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      deliveryId: input.deliveryId,
      eventType: "push",
      branch: parsed.branch,
      commitSha: parsed.commitSha,
      baseCommitSha: input.payload.before,
      payload: input.payload as unknown as Record<string, unknown>,
      status: eventStatus,
      errorMessage:
        eventStatus === "failed" && typeof outcome.reason === "string"
          ? outcome.reason
          : undefined,
    });

    return outcome;
  } catch (error) {
    await markRepositorySyncError(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      githubRepositoryId: input.project.github_repository_id,
      errorCode: "push_detection_failed",
    });
    await recordEvent(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      deliveryId: input.deliveryId,
      eventType: "push",
      branch: parsed.branch,
      commitSha: parsed.commitSha,
      payload: input.payload as unknown as Record<string, unknown>,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Push detection failed",
    });
    throw error;
  }
}

async function handlePushEventWithScan(
  admin: SupabaseClient,
  input: {
    project: ProjectRow;
    deliveryId: string | null;
    payload: GitHubPushPayload;
    token: string;
    userId: string;
    appUrl?: string;
  },
  parsed: { branch: string; commitSha: string }
) {
  const branch = parsed.branch;
  const headSha = parsed.commitSha;
  const baseSha = input.payload.before;

  await recordRepositoryActivity(admin, {
    organizationId: input.project.organization_id,
    projectId: input.project.id,
    eventType: "push_received",
    title: "Push received from GitHub",
    description: `Branch ${branch} · ${headSha.slice(0, 7)}`,
    metadata: { branch, headSha, baseSha },
  });

  const { data: state } = await admin
    .from("repository_scan_state")
    .select("last_commit_sha, last_full_scan_at")
    .eq("repository_id", input.project.id)
    .maybeSingle();

  const effectiveBase =
    baseSha && baseSha !== "0000000000000000000000000000000000000000"
      ? baseSha
      : state?.last_commit_sha ?? undefined;

  const scanType =
    effectiveBase && state?.last_full_scan_at ? "incremental" : "full";
  const scanId = await createAutomationScan(admin, {
    organizationId: input.project.organization_id,
    projectId: input.project.id,
    userId: input.userId,
    scanType,
    branch,
    commitSha: headSha,
  });

  if (!scanId) {
    await recordEvent(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      deliveryId: input.deliveryId,
      eventType: "push",
      branch,
      commitSha: headSha,
      payload: input.payload as unknown as Record<string, unknown>,
      status: "ignored",
      errorMessage: "Scan already in progress",
    });
    return { ok: true, action: "skipped", reason: "scan_in_progress" };
  }

  if (scanType === "incremental" && effectiveBase) {
    await postGitHubCommitStatus({
      githubRepo: input.project.github_repo!,
      sha: headSha,
      token: input.token,
      state: "pending",
      context: "sequrai/production",
      description: "Production analysis in progress",
    });
  }

  await enqueueAutomationScan(admin, {
    scanId,
    project: input.project,
    userId: input.userId,
    branch,
    scanType,
    baseCommitSha: scanType === "incremental" ? effectiveBase : undefined,
    headCommitSha: headSha,
    triggerLabel: `Push to ${branch}`,
    statusSha: headSha,
    appUrl: input.appUrl,
    jobType: "webhook_push_scan",
    finalize: {
      kind: "webhook_automation",
      triggerLabel: `Push to ${branch}`,
      statusSha: headSha,
      appUrl: input.appUrl,
      ...(scanType === "incremental" && effectiveBase
        ? { incremental: { baseSha: effectiveBase, headSha } }
        : {}),
    },
  });

  return { ok: true, action: "scan_queued", scanId };
}

async function handlePullRequestEvent(
  admin: SupabaseClient,
  input: {
    project: ProjectRow;
    deliveryId: string | null;
    payload: GitHubPullRequestPayload;
    token: string;
    userId: string;
    appUrl?: string;
  }
) {
  const action = input.payload.action;
  const pr = input.payload.pull_request;
  if (!["opened", "synchronize", "reopened"].includes(action)) {
    await recordEvent(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      deliveryId: input.deliveryId,
      eventType: "pull_request",
      action,
      pullRequestNumber: pr.number,
      payload: input.payload as unknown as Record<string, unknown>,
      status: "ignored",
    });
    return { ok: true, action: "ignored", reason: "pr_action_ignored" };
  }

  const headSha = pr.head.sha;
  const baseSha = pr.base.sha;
  const headBranch = pr.head.ref;
  const baseBranch = pr.base.ref;

  await recordEvent(admin, {
    organizationId: input.project.organization_id,
    projectId: input.project.id,
    deliveryId: input.deliveryId,
    eventType: "pull_request",
    action,
    branch: headBranch,
    commitSha: headSha,
    baseCommitSha: baseSha,
    pullRequestNumber: pr.number,
    payload: input.payload as unknown as Record<string, unknown>,
    status: "processing",
  });

  await recordRepositoryActivity(admin, {
    organizationId: input.project.organization_id,
    projectId: input.project.id,
    eventType: "pull_request_received",
    title: "Pull Request analyzed",
    description: `#${pr.number} ${pr.title}`,
    metadata: { pullRequestNumber: pr.number, headSha, baseSha },
  });

  const scoreBefore = input.project.security_score;
  const scanId = await createAutomationScan(admin, {
    organizationId: input.project.organization_id,
    projectId: input.project.id,
    userId: input.userId,
    scanType: "incremental",
    branch: headBranch,
    commitSha: headSha,
  });

  if (!scanId) {
    return { ok: true, action: "skipped", reason: "scan_in_progress" };
  }

  await postGitHubCommitStatus({
    githubRepo: input.project.github_repo!,
    sha: headSha,
    token: input.token,
    state: "pending",
    context: "sequrai/production",
    description: "Pull Request production analysis in progress",
  });

  const prReportBase = input.appUrl
    ? `${input.appUrl}/projects/${input.project.id}/pull-requests/${pr.number}`
    : undefined;
  await postPendingGitHubCheckRun({
    githubRepo: input.project.github_repo!,
    sha: headSha,
    token: input.token,
    externalId: buildCheckRunExternalId({ pullRequestNumber: pr.number, headSha }),
    reportUrl: prReportBase ? `${prReportBase}?head=${headSha}` : undefined,
  });

  await enqueueAutomationScan(admin, {
    scanId,
    project: input.project,
    userId: input.userId,
    branch: headBranch,
    scanType: "incremental",
    baseCommitSha: baseSha,
    headCommitSha: headSha,
    triggerLabel: `Pull Request #${pr.number}`,
    statusSha: headSha,
    appUrl: input.appUrl,
    jobType: "webhook_pr_scan",
    finalize: {
      kind: "webhook_pr",
      pullRequestNumber: pr.number,
      pullRequestTitle: pr.title,
      baseBranch,
      headBranch,
      baseSha,
      headSha,
      scoreBefore,
      appUrl: input.appUrl,
    },
  });

  await recordEvent(admin, {
    organizationId: input.project.organization_id,
    projectId: input.project.id,
    deliveryId: input.deliveryId,
    eventType: "pull_request",
    action,
    branch: headBranch,
    commitSha: headSha,
    baseCommitSha: baseSha,
    pullRequestNumber: pr.number,
    payload: input.payload as unknown as Record<string, unknown>,
    status: "processed",
  });

  return { ok: true, action: "pr_scan_queued", scanId };
}

async function handleRepositoryEvent(
  admin: SupabaseClient,
  input: {
    project: ProjectRow;
    deliveryId: string | null;
    payload: GitHubRepositoryPayload;
    eventType: string;
  }
) {
  const action = input.payload.action;
  const repositoryId = input.payload.repository?.id ?? input.project.github_repository_id;

  if (action === "deleted") {
    await admin
      .from("projects")
      .update({ webhook_enabled: false, github_last_commit_sha: null })
      .eq("id", input.project.id);
    await admin.from("repository_sync_status").upsert(
      {
        project_id: input.project.id,
        organization_id: input.project.organization_id,
        github_repository_id: repositoryId,
        connection_status: "disconnected",
        last_error: "GitHub repository was deleted.",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" }
    );
    await recordRepositoryActivity(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      eventType: "repository_deleted",
      title: "GitHub repository deleted",
      description: "Automation paused until repository is reconnected.",
    });
  } else if (action === "renamed" && input.payload.repository?.full_name) {
    const fullName = input.payload.repository.full_name;
    const githubRepoUrl = `https://github.com/${fullName}`;
    const previousName = input.payload.changes?.repository?.name?.from;
    await admin
      .from("projects")
      .update({ github_repo: githubRepoUrl, name: fullName.split("/")[1] ?? input.project.name })
      .eq("id", input.project.id)
      .eq("github_repository_id", repositoryId);
    await recordRepositoryActivity(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      eventType: "repository_renamed",
      title: "GitHub repository renamed",
      description: previousName ? `Previously ${previousName} · now ${fullName}` : `Now ${fullName}`,
    });
  } else if (action === "transferred") {
    await admin
      .from("projects")
      .update({ webhook_enabled: false })
      .eq("id", input.project.id);
    await admin.from("repository_sync_status").upsert(
      {
        project_id: input.project.id,
        organization_id: input.project.organization_id,
        github_repository_id: repositoryId,
        connection_status: "connection_issue",
        last_error:
          "Repository ownership changed on GitHub. Revalidate the connection in SequrAI before scanning resumes.",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" }
    );
    await recordRepositoryActivity(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      eventType: "repository_transferred",
      title: "GitHub repository transferred",
      description:
        "SequrAI paused automation until the Workspace explicitly revalidates repository ownership.",
    });
  }

  await recordEvent(admin, {
    organizationId: input.project.organization_id,
    projectId: input.project.id,
    deliveryId: input.deliveryId,
    eventType: input.eventType,
    action,
    payload: input.payload as unknown as Record<string, unknown>,
    status: "processed",
  });
  return { ok: true, action: "repository_updated" };
}

async function handleBranchDelete(
  admin: SupabaseClient,
  input: {
    project: ProjectRow;
    deliveryId: string | null;
    payload: Record<string, unknown>;
    eventType: string;
  }
) {
  const refType = input.payload.ref_type as string | undefined;
  const ref = input.payload.ref as string | undefined;
  if (refType === "branch" && ref) {
    await recordRepositoryActivity(admin, {
      organizationId: input.project.organization_id,
      projectId: input.project.id,
      eventType: "branch_deleted",
      title: "Branch deleted",
      description: ref,
    });
  }

  await recordEvent(admin, {
    organizationId: input.project.organization_id,
    projectId: input.project.id,
    deliveryId: input.deliveryId,
    eventType: input.eventType,
    branch: ref,
    payload: input.payload,
    status: "processed",
  });
  return { ok: true, action: "branch_delete_recorded" };
}
