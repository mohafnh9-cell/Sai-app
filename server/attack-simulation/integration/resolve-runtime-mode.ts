import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import type { AttackRuntimeMode } from "../contracts/enums";

const STAGING_ENVIRONMENTS = new Set<AttackAuthorizationRecord["environmentType"]>([
  "staging",
  "preview",
  "local",
]);

export function resolveAttackRuntimeModeForScan(input: {
  authorization?: AttackAuthorizationRecord | null;
  targetUrl?: string | null;
}): AttackRuntimeMode {
  if (input.authorization && STAGING_ENVIRONMENTS.has(input.authorization.environmentType)) {
    return "authorized_staging";
  }
  if (input.targetUrl) {
    return "sandbox";
  }
  return "mock";
}

export function isAttackAuthorizationAllowedForStagingApi(
  environmentType: AttackAuthorizationRecord["environmentType"]
): boolean {
  return STAGING_ENVIRONMENTS.has(environmentType);
}
