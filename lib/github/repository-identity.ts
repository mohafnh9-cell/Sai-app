/**
 * A project's repository identity is GitHub's numeric repository id, not its
 * `owner/name`. The name can be released and reused by a different repository
 * (delete and recreate, transfer, rename-then-reuse); the numeric id cannot.
 *
 * Evidence (scans, findings, verdicts) is keyed by project, so a project that
 * is silently repointed at a different repository would present the old
 * repository's evidence as the new one's. The rule: once a project is bound to
 * a repository id it stays bound to it. A different id is a different
 * repository and must start a new project (a new evidence lineage); the old
 * project and its history are preserved untouched.
 */
export function repositoryIdentityMatches(
  boundRepositoryId: unknown,
  actualRepositoryId: number
): boolean {
  // Legacy/uploaded projects that were never bound have nothing to conflict
  // with; the first real fetch binds them.
  if (boundRepositoryId === null || boundRepositoryId === undefined) return true;
  const bound = Number(boundRepositoryId);
  return Number.isFinite(bound) && bound === actualRepositoryId;
}

export class RepositoryIdentityChangedError extends Error {
  readonly code = "REPOSITORY_IDENTITY_CHANGED" as const;

  constructor() {
    super(
      "This project is connected to a different repository than the one this name now points to. Reconnect the repository to start a new review history."
    );
    this.name = "RepositoryIdentityChangedError";
  }
}

export function assertRepositoryIdentityUnchanged(
  boundRepositoryId: unknown,
  actualRepositoryId: number
): void {
  if (!repositoryIdentityMatches(boundRepositoryId, actualRepositoryId)) {
    throw new RepositoryIdentityChangedError();
  }
}
