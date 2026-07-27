import { isFeatureEnabled } from "@/server/feature-flags";

/** RT9 persistence rolls out independently of analysis (partial rollout). */
export function isBusinessLogicPersistenceEnabled(context?: {
  organizationId?: string;
}): boolean {
  if (
    !isFeatureEnabled("business_logic_team", {
      organizationId: context?.organizationId,
    })
  ) {
    return false;
  }
  return isFeatureEnabled("business_logic_persistence", {
    organizationId: context?.organizationId,
  });
}
