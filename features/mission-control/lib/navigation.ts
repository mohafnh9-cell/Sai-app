/** When Security Test should appear in project navigation. Server-safe — no React or client APIs. */
export function shouldShowSecurityTestNav(input: {
  attackCenterEnabled: boolean;
  hasVerdict: boolean;
  verdictReadyToShip: boolean;
  securityTestPhase?: string | null;
}): boolean {
  if (!input.attackCenterEnabled || !input.hasVerdict) return false;
  if (input.verdictReadyToShip) {
    const activePhases = new Set(["running", "issues_found", "fix_ready", "protected", "completed_clean"]);
    return input.securityTestPhase ? activePhases.has(input.securityTestPhase) : false;
  }
  return true;
}
