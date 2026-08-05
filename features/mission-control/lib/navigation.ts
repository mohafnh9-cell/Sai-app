/** When security testing tab should appear in project navigation. Server-safe — no React or client APIs. */
export function shouldShowSecurityTestNav(input: {
  attackCenterEnabled: boolean;
  hasVerdict?: boolean;
  verdictReadyToShip?: boolean;
  securityTestPhase?: string | null;
}): boolean {
  return input.attackCenterEnabled;
}
