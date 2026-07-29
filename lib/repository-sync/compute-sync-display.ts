import { commitsMatch } from "@/lib/repository-sync/commits-match";

export type GithubSyncDisplay = {
  githubHeadSha: string | null;
  /** Last Production Verdict commit (idle baseline). */
  lastVerdictCommitSha: string | null;
  /** Active review target commit, if any. */
  activeReviewCommitSha: string | null;
  /** SHA to show as "latest analyzed" in UI. */
  displayAnalyzedCommitSha: string | null;
  /** Review running against current GitHub HEAD. */
  syncInProgress: boolean;
  /** Verdict is behind GitHub and no in-progress review on HEAD. */
  repositoryOutOfSync: boolean;
};

export function computeGithubSyncDisplay(input: {
  githubHeadSha: string | null;
  lastVerdictCommitSha: string | null;
  activeReviewCommitSha?: string | null;
  hasActiveReview?: boolean;
}): GithubSyncDisplay {
  const activeReviewCommitSha =
    input.hasActiveReview && input.activeReviewCommitSha
      ? input.activeReviewCommitSha
      : null;

  const syncInProgress =
    Boolean(input.githubHeadSha) &&
    Boolean(activeReviewCommitSha) &&
    commitsMatch(input.githubHeadSha, activeReviewCommitSha);

  const repositoryOutOfSync =
    Boolean(input.githubHeadSha) &&
    Boolean(input.lastVerdictCommitSha) &&
    !commitsMatch(input.githubHeadSha, input.lastVerdictCommitSha) &&
    !syncInProgress;

  const displayAnalyzedCommitSha =
    activeReviewCommitSha ?? input.lastVerdictCommitSha ?? null;

  return {
    githubHeadSha: input.githubHeadSha,
    lastVerdictCommitSha: input.lastVerdictCommitSha,
    activeReviewCommitSha,
    displayAnalyzedCommitSha,
    syncInProgress,
    repositoryOutOfSync,
  };
}
