import "server-only";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SHORT_SHA = /^[0-9a-f]{7,39}$/i;

export class InvalidCommitShaError extends Error {
  constructor(message = "Invalid commit SHA") {
    super(message);
    this.name = "InvalidCommitShaError";
  }
}

/** Normalize and validate a Git commit SHA (full or abbreviated, min 7 hex chars). */
export function normalizeCommitSha(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || (!FULL_SHA.test(trimmed) && !SHORT_SHA.test(trimmed))) {
    throw new InvalidCommitShaError();
  }
  return trimmed;
}

export function isValidCommitSha(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    normalizeCommitSha(value);
    return true;
  } catch {
    return false;
  }
}
