import type { DiscoveryReport } from "../../discovery/types";
import { buildBusinessLogicOrchestrationHintsFromDiscovery } from "./business-logic-aso-bridge";

export type { BusinessLogicAsoOrchestrationHints } from "../business-logic/integration/platform-payload";

/** RT13: expose scheduling metadata only — no auto execution. */
export function planBusinessLogicOrchestrationMetadata(input: {
  discovery: DiscoveryReport;
  businessLogicEnabled: boolean;
}): ReturnType<typeof buildBusinessLogicOrchestrationHintsFromDiscovery> | null {
  if (!input.businessLogicEnabled) return null;
  return buildBusinessLogicOrchestrationHintsFromDiscovery(input.discovery);
}
