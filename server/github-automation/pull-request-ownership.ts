import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseGitHubRepository } from "@/lib/github/repository-service";
import { isDefaultBranchHead } from "@/server/repository-sync/persistence";

const GITHUB_API = "https://api.github.com";

/**
 * A push to a feature branch that has an open pull request is owned by the
 * `pull_request` lifecycle (opened / synchronize): that event produces the
 * canonical scan, verdict and check for the commit. Running the push review
 * as well creates a second, competing verdict for the same commit.
 *
 * Returns the open PR number, or null when the branch is the default branch,
 * has no open PR, or ownership cannot be determined (fail open: an
 * unreviewed commit is worse than a duplicate review).
 */
export async function findOwningOpenPullRequest(
  admin: SupabaseClient,
  input: {
    projectId: string;
    githubRepo: string | null;
    branch: string;
    token: string;
    fetchImpl?: typeof fetch;
  }
): Promise<number | null> {
  if (!input.githubRepo) return null;
  if (await isDefaultBranchHead(admin, input.projectId, input.branch)) return null;
  try {
    const ref = parseGitHubRepository(input.githubRepo);
    const url = `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls?state=open&head=${encodeURIComponent(`${ref.owner}:${input.branch}`)}&per_page=1`;
    const response = await (input.fetchImpl ?? fetch)(url, {
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Array<{ number?: number }>;
    const number = Array.isArray(body) ? body[0]?.number : undefined;
    return typeof number === "number" ? number : null;
  } catch {
    return null;
  }
}
