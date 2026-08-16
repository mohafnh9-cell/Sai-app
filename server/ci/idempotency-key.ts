import "server-only";

/** Deterministic idempotency key for CI executions (not stored as random UUIDs). */
export function buildCiIdempotencyKey(input: {
  projectId: string;
  commitSha: string;
  prNumber?: number | null;
}): string {
  const prSegment = input.prNumber != null ? `pr-${input.prNumber}` : "push";
  return `sequrai-ci:${input.projectId}:${input.commitSha.toLowerCase()}:${prSegment}`;
}
