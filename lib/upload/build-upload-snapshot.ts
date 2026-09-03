import { createHash } from "node:crypto";
import type { RepositoryFile, RepositorySnapshot } from "@/lib/github/repository-service";

/**
 * The "source adapter" for upload analysis (Phase 10): turns validated,
 * extracted archive contents into the exact same RepositorySnapshot shape
 * GitHubRepositoryService.fetchSnapshot() produces, so InlineScanJobRunner
 * can run an uploaded project through the identical scan pipeline. There is
 * no real commit/branch/repository identity for an upload, so a stable
 * content hash stands in for commitSha (a re-upload of byte-identical
 * content yields the same value, which reads naturally as a short SHA in
 * the UI and costs nothing extra to compute).
 */
export function buildUploadSnapshot(input: {
  projectName: string;
  files: RepositoryFile[];
  totalBytes: number;
  omissions: RepositorySnapshot["omissions"];
}): RepositorySnapshot {
  const hash = createHash("sha256");
  for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  const contentSha = hash.digest("hex").slice(0, 40);

  return {
    repositoryId: 0,
    owner: "",
    repo: input.projectName,
    isPrivate: true,
    defaultBranch: "upload",
    commitSha: contentSha,
    files: input.files,
    discoveredFiles: input.files.length,
    totalBytes: input.totalBytes,
    omissions: input.omissions,
  };
}
