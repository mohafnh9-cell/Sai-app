import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshGitHubHeadForProject } from "@/server/repository-sync/refresh-github-head";

export class ReviewCommitResolutionError extends Error {
  constructor(
    public readonly code: "GITHUB_TOKEN_UNAVAILABLE" | "GITHUB_HEAD_UNAVAILABLE",
    message: string
  ) {
    super(message);
    this.name = "ReviewCommitResolutionError";
  }
}

export async function resolveLatestReviewCommit(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    githubRepo: string;
    githubRepositoryId?: number | null;
    branch?: string | null;
  }
): Promise<{ commitSha: string; branch: string }> {
  let failureReason: "no_token" | "github_auth" | "github_other" | null = null;
  const head = await refreshGitHubHeadForProject(admin, {
    ...input,
    onFailure: (reason) => {
      failureReason = reason;
    },
  });
  if (!head) {
    if (failureReason === "no_token" || failureReason === "github_auth") {
      throw new ReviewCommitResolutionError(
        "GITHUB_TOKEN_UNAVAILABLE",
        "GitHub authorization is missing or no longer valid for this repository"
      );
    }
    throw new ReviewCommitResolutionError(
      "GITHUB_HEAD_UNAVAILABLE",
      "Could not resolve the latest commit from GitHub"
    );
  }
  return { commitSha: head.commitSha, branch: head.branch };
}
