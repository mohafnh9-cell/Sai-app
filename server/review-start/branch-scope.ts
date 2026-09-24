/**
 * Review LIFECYCLE scope is (repository, branch). A scan without a branch on a
 * GitHub-connected project belongs to the default branch. Production DECISION
 * scope is the default branch + commit and is handled elsewhere.
 */
export function scanScope(scanBranch: string | null | undefined, defaultBranch: string | null): string | null {
  return (scanBranch ?? null) ?? defaultBranch;
}

/** True when a scan belongs to `targetBranch` (defaults to the default branch). Unknown scope never matches implicitly. */
export function scanInBranchScope(
  scanBranch: string | null | undefined,
  targetBranch: string | null | undefined,
  defaultBranch: string | null
): boolean {
  const target = targetBranch ?? defaultBranch;
  const scan = scanScope(scanBranch, defaultBranch);
  // Both unknown (legacy, no default recorded): keep the previous project-wide behaviour.
  if (!target && !scan) return true;
  return target === scan;
}
