import "server-only";

import { formatGithubCheckSummary } from "@/brain/production-verdict/adapters/format";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { parseGitHubRepository } from "@/lib/github/repository-service";
import { deriveDecisionLanguagePolicy } from "@/server/mcp/decision-language-policy";
import { mapVerdictStatusToDecision } from "@/server/mcp/decision-mapping";

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

export type GitHubDecisionPresentation = {
  conclusion: GitHubCheckConclusion;
  title: string;
  /** Replaces the verdict label in summaries/descriptions (never an approval unless the evidence supports it). */
  label: string;
};

/**
 * What GitHub may say about a verdict. "Ready to Ship / GO / success" is an
 * approval, so it is reserved for the canonical policy's HIGH_CONFIDENCE
 * strength; a ready verdict with low confidence or unevaluated areas is
 * reported as "no blockers found, evidence limited" with a neutral conclusion.
 */
export function githubDecisionPresentation(
  verdict: Pick<
    ProductionVerdictV1,
    "status" | "confidence" | "unevaluatedAreas" | "partiallyEvaluatedAreas"
  >,
  options?: { checkStatus?: "passed" | "failed" | "warning" | "pending" | null }
): GitHubDecisionPresentation {
  const conclusion = verdictStatusToCheckConclusion(verdict.status, options);
  if (verdict.status === "ready_to_ship" && conclusion === "success") {
    const policy = deriveDecisionLanguagePolicy({
      status: verdict.status,
      confidence: verdict.confidence,
      unevaluatedAreaCount: verdict.unevaluatedAreas.length,
      partiallyEvaluatedAreaCount: verdict.partiallyEvaluatedAreas.length,
      baseDecision: mapVerdictStatusToDecision(verdict.status),
      freshnessStatus: "current",
      reviewInProgress: false,
      reviewFailed: false,
    });
    if (policy.strength === "HIGH_CONFIDENCE") {
      return { conclusion: "success", title: "GO", label: "SequrAI — Ready to Ship" };
    }
    return {
      conclusion: "neutral",
      title: "NO BLOCKERS FOUND — EVIDENCE LIMITED",
      label: "SequrAI — No blockers found (evidence limited)",
    };
  }
  if (conclusion === "action_required") {
    return { conclusion, title: "MORE ANALYSIS REQUIRED", label: "SequrAI — More Analysis Required" };
  }
  if (conclusion === "neutral") {
    return { conclusion, title: "ANALYSIS PENDING", label: "SequrAI — Analysis pending" };
  }
  return {
    conclusion,
    title: verdict.status === "analysis_failed" ? "ANALYSIS FAILED" : "NO-GO",
    label:
      verdict.status === "analysis_failed" ? "SequrAI — Analysis Failed" : "SequrAI — Not Ready",
  };
}

export function buildCheckRunExternalId(input: {
  pullRequestNumber: number;
  headSha: string;
}): string {
  return `sequrai-pr-${input.pullRequestNumber}-${input.headSha.slice(0, 12)}`;
}

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
});

/**
 * Finds the check run this app already opened for the commit (the
 * "in_progress" one posted when the PR scan started), so the final result
 * UPDATES it. Creating a second run instead leaves the first one
 * in_progress forever. Matches on external_id and never touches a run that
 * is already completed (a retry then creates nothing new and changes nothing
 * it should not).
 */
async function findOpenCheckRunId(input: {
  owner: string;
  repo: string;
  sha: string;
  token: string;
  name: string;
  externalId?: string;
}): Promise<number | null> {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/commits/${encodeURIComponent(input.sha)}/check-runs?check_name=${encodeURIComponent(input.name)}&per_page=50`;
  try {
    const response = await fetch(url, { headers: GH_HEADERS(input.token) });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      check_runs?: Array<{ id: number; status: string; external_id?: string | null }>;
    };
    const open = (body.check_runs ?? []).filter(
      (run) =>
        run.status !== "completed" && (!input.externalId || run.external_id === input.externalId)
    );
    return open[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function writeCompletedCheckRun(input: {
  githubRepo: string;
  sha: string;
  token: string;
  name: string;
  conclusion: GitHubCheckConclusion;
  detailsUrl?: string;
  externalId?: string;
  output: { title: string; summary: string; text?: string };
}): Promise<{ checkRunId: number | null }> {
  const ref = parseGitHubRepository(input.githubRepo);
  const base = `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/check-runs`;
  const openId = await findOpenCheckRunId({
    owner: ref.owner,
    repo: ref.repo,
    sha: input.sha,
    token: input.token,
    name: input.name,
    externalId: input.externalId,
  });
  const body = JSON.stringify({
    name: input.name,
    head_sha: input.sha,
    status: "completed",
    conclusion: input.conclusion,
    details_url: input.detailsUrl,
    external_id: input.externalId,
    completed_at: new Date().toISOString(),
    output: input.output,
  });
  const response = await fetch(openId ? `${base}/${openId}` : base, {
    method: openId ? "PATCH" : "POST",
    headers: GH_HEADERS(input.token),
    body,
  });
  if (!response.ok) {
    console.warn("github_check_run_post_failed", {
      status: response.status,
      sha: input.sha,
      updatedExisting: Boolean(openId),
    });
    // Observable and retryable: the idempotency record is only written when
    // this resolves, so a failed GitHub call is retried instead of being
    // recorded as done while the check stays in_progress.
    throw new Error(`GitHub check run ${openId ? "update" : "create"} failed (${response.status})`);
  }
  const json = (await response.json()) as { id?: number };
  return { checkRunId: json.id ?? openId ?? null };
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
  const presentation = githubDecisionPresentation(input.verdict);
  // The caller's conclusion may only be made MORE cautious by the policy,
  // never stronger: a policy-neutral verdict is never reported as success.
  const conclusion = input.conclusion === "success" ? presentation.conclusion : input.conclusion;
  const rawSummary = formatGithubCheckSummary({
    verdict: input.verdict,
    reportUrl: input.reportUrl,
  });
  const lines = rawSummary.split("\n");
  lines[0] = presentation.label;
  return writeCompletedCheckRun({
    githubRepo: input.githubRepo,
    sha: input.sha,
    token: input.token,
    name: input.name ?? SEQURAI_CHECK_RUN_NAME,
    conclusion,
    detailsUrl: input.reportUrl,
    externalId: input.externalId,
    output: {
      title: presentation.title,
      summary: lines.join("\n"),
      text: [
        `Analyzed commit: ${input.sha.slice(0, 12)}`,
        input.pullRequestNumber != null ? `Pull request: #${input.pullRequestNumber}` : null,
        `Blockers: ${input.verdict.blockersCount}`,
        `Critical/high findings drive the Production Verdict.`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  });
}

/**
 * Terminal state for a PR check whose Production Verdict could not be
 * obtained in time. It is never a success and never an approval: the open
 * "in_progress" run is closed as neutral so the PR is not left waiting
 * forever, and says plainly that no decision was made.
 */
export async function postUnavailableGitHubCheckRun(input: {
  githubRepo: string;
  sha: string;
  token: string;
  name?: string;
  reason: string;
  reportUrl?: string;
  pullRequestNumber?: number;
  externalId?: string;
}): Promise<{ checkRunId: number | null }> {
  return writeCompletedCheckRun({
    githubRepo: input.githubRepo,
    sha: input.sha,
    token: input.token,
    name: input.name ?? SEQURAI_CHECK_RUN_NAME,
    conclusion: "neutral",
    detailsUrl: input.reportUrl,
    externalId: input.externalId,
    output: {
      title: "VERDICT UNAVAILABLE",
      summary: [
        "SequrAI — Verdict unavailable",
        `SequrAI did not produce a Production Verdict for commit ${input.sha.slice(0, 12)} (${input.reason}).`,
        "This is not an approval. Re-run the review to get a deployment answer.",
        input.reportUrl ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  });
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
