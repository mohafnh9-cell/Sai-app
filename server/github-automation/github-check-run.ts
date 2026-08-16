import "server-only";

import { formatGithubCheckSummary } from "@/brain/production-verdict/adapters/format";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { parseGitHubRepository } from "@/lib/github/repository-service";

const GITHUB_API = "https://api.github.com";

export const SEQURAI_CHECK_RUN_NAME = "SequrAI — Production Verdict";

export type GitHubCheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "timed_out"
  | "action_required"
  | "skipped";

export function verdictStatusToCheckConclusion(
  status: ProductionVerdictV1["status"] | string | null | undefined,
  options?: {
    checkStatus?: "passed" | "failed" | "warning" | "pending" | null;
    scanMissing?: boolean;
  }
): GitHubCheckConclusion {
  if (options?.scanMissing || options?.checkStatus === "pending") {
    return "neutral";
  }
  if (!status || status === "analysis_failed") {
    return "failure";
  }
  if (status === "ready_to_ship") {
    return "success";
  }
  if (status === "insufficient_data") {
    return "action_required";
  }
  return "failure";
}

export function buildCheckRunExternalId(input: {
  pullRequestNumber: number;
  headSha: string;
}): string {
  return `sequrai-pr-${input.pullRequestNumber}-${input.headSha.slice(0, 12)}`;
}

export async function postGitHubCheckRun(input: {
  githubRepo: string;
  sha: string;
  token: string;
  name?: string;
  conclusion: GitHubCheckConclusion;
  verdict: ProductionVerdictV1;
  reportUrl?: string;
  pullRequestNumber?: number;
  externalId?: string;
}): Promise<{ checkRunId: number | null }> {
  const ref = parseGitHubRepository(input.githubRepo);
  const url = `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/check-runs`;
  const summary = formatGithubCheckSummary({
    verdict: input.verdict,
    reportUrl: input.reportUrl,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      name: input.name ?? SEQURAI_CHECK_RUN_NAME,
      head_sha: input.sha,
      status: "completed",
      conclusion: input.conclusion,
      details_url: input.reportUrl,
      external_id: input.externalId,
      output: {
        title: input.verdict.status === "ready_to_ship" ? "GO" : "NO-GO",
        summary,
        text: [
          `Analyzed commit: ${input.sha.slice(0, 12)}`,
          input.pullRequestNumber != null ? `Pull request: #${input.pullRequestNumber}` : null,
          `Blockers: ${input.verdict.blockersCount}`,
          `Critical/high findings drive the Production Verdict.`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    }),
  });

  if (!response.ok) {
    console.warn("github_check_run_post_failed", {
      status: response.status,
      sha: input.sha,
    });
    return { checkRunId: null };
  }

  const body = (await response.json()) as { id?: number };
  return { checkRunId: body.id ?? null };
}

export async function postPendingGitHubCheckRun(input: {
  githubRepo: string;
  sha: string;
  token: string;
  name?: string;
  externalId?: string;
  reportUrl?: string;
}): Promise<void> {
  const ref = parseGitHubRepository(input.githubRepo);
  const url = `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/check-runs`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      name: input.name ?? SEQURAI_CHECK_RUN_NAME,
      head_sha: input.sha,
      status: "in_progress",
      external_id: input.externalId,
      details_url: input.reportUrl,
      output: {
        title: "Analyzing pull request",
        summary: "SequrAI is running an incremental Production Verdict on this commit.",
      },
    }),
  });

  if (!response.ok) {
    console.warn("github_check_run_pending_failed", {
      status: response.status,
      sha: input.sha,
    });
  }
}
