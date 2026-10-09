/**
 * Maps the engine's domain errors to a controlled HTTP response. Every code here is raised BEFORE the engine
 * writes anything for that call, except where the route documentation says otherwise
 * (a changed proposal commit on an APPROVED record may already have reopened it to READY and stored the new SHA
 * before the transition to APPLIED was refused: callers must re-read the record after ANY non-200).
 */
export type SafeFixHttpError = { status: 404 | 409 | 503; error: string };

export function mapSafeFixError(error: unknown): SafeFixHttpError | null {
  const message = error instanceof Error ? error.message : "";
  if (message === "safe_fix_not_found") return { status: 404, error: "Not found" };
  if (message === "proposal_commit_unsupported") return { status: 503, error: message };
  if (
    message.startsWith("invalid_transition") ||
    message === "proposal_commit_locked" ||
    message === "proposal_commit_is_base_commit" ||
    message === "proposal_commit_conflict"
  ) {
    return { status: 409, error: message };
  }
  return null;
}
