export type ProductionReviewCommitSource =
  | "github_live_head"
  | "explicit_sha"
  | "webhook";

export type ProductionReviewCommitTarget = {
  repositoryId: string;
  owner: string;
  repository: string;
  branch: string;
  commitSha: string;
  committedAt: string | null;
  resolvedAt: string;
  source: ProductionReviewCommitSource;
};

export function assertCommitTarget(
  target: Partial<ProductionReviewCommitTarget>
): asserts target is ProductionReviewCommitTarget {
  if (!target.commitSha?.trim()) {
    throw new Error("Production review commit SHA is required");
  }
  if (!target.branch?.trim()) {
    throw new Error("Production review branch is required");
  }
}
