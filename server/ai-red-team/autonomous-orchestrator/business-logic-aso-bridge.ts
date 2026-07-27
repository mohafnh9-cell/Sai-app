import type { DiscoveryReport } from "../discovery/types";
import type { BusinessLogicAsoOrchestrationHints } from "../business-logic/integration/platform-payload";

export function buildBusinessLogicOrchestrationHintsFromDiscovery(
  discovery: DiscoveryReport
): BusinessLogicAsoOrchestrationHints {
  const hasPayments = discovery.payments.length > 0;
  const hasWebhooks = discovery.potentialAttackSurface.some((a) => a.area === "webhooks");
  return {
    teamId: "business_logic",
    attackDomain: "payments",
    supportedOperations: [
      "business_logic_review",
      "replay_validation",
      "reanalysis",
      "incremental_workflow_scan",
      "selective_specialist_execution",
    ],
    autoExecute: false,
    incrementalWorkflowScanEligible: hasPayments && hasWebhooks,
    selectiveSpecialistEligible: hasPayments,
    replayValidationEligible: hasPayments,
  };
}
