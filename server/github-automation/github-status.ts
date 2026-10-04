import "server-only";

import { parseGitHubRepository } from "@/lib/github/repository-service";
import type { HealthStatus } from "./health";

const GITHUB_API = "https://api.github.com";

export async function postGitHubCommitStatus(input: {
  githubRepo: string;
  sha: string;
  token: string;
  state: "pending" | "success" | "failure" | "error";
  context: string;
  description: string;
  targetUrl?: string;
}) {
  const ref = parseGitHubRepository(input.githubRepo);
  const url = `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/statuses/${encodeURIComponent(input.sha)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      state: input.state,
      context: input.context,
      description: input.description.slice(0, 140),
      target_url: input.targetUrl,
    }),
  });
  if (!response.ok) {
    console.warn("github_status_post_failed", {
      status: response.status,
      sha: input.sha,
    });
  }
}

export function statusFromSecurityCheck(
  checkStatus: "passed" | "failed" | "warning"
): "success" | "failure" | "pending" {
  if (checkStatus === "passed") return "success";
  // "warning" (high findings / low score) is a terminal, non-clean result;
  // reporting it as "pending" left the commit status waiting forever.
  return "failure";
}

export function healthLabel(status: HealthStatus): string {
  switch (status) {
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "needs_attention":
      return "Needs Attention";
    case "critical":
      return "Critical";
  }
}
