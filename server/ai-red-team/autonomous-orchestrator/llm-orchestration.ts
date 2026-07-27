import type { DiscoveryReport } from "../discovery/types";
import type { LlmAsoOrchestrationHints } from "../llm-team/integration/platform-payload";
import { buildAiDiscoveryInventory } from "../llm-team/discovery/build-ai-discovery";

export type { LlmAsoOrchestrationHints };

/** RT13: expose scheduling metadata only — no auto execution. */
export function planLlmOrchestrationMetadata(input: {
  discovery: DiscoveryReport;
  llmEnabled: boolean;
}): LlmAsoOrchestrationHints | null {
  if (!input.llmEnabled) return null;
  const inventory = buildAiDiscoveryInventory(input.discovery);
  const hasAi = inventory.components.length > 0 || input.discovery.aiProviders.length > 0;
  if (!hasAi) return null;
  const hasMcp = inventory.components.some(
    (c) => c.kind === "mcp_server" || c.kind === "mcp_client"
  );
  const hasAgents = inventory.components.some((c) => c.kind === "agent_framework");
  const hasMemory = inventory.components.some((c) => c.kind === "memory_store");
  return {
    teamId: "llm",
    attackDomain: "llm",
    supportedOperations: [
      "prompt_validation",
      "replay_validation",
      "selective_specialist_execution",
      "incremental_ai_scan",
      "trust_boundary_revalidation",
      "agent_revalidation",
      "mcp_revalidation",
      "memory_revalidation",
    ],
    autoExecute: false,
    promptValidationEligible: hasAi,
    replayValidationEligible: hasAi,
    selectiveSpecialistEligible: hasAi,
    incrementalAiScanEligible: inventory.components.length > 2,
    trustBoundaryRevalidationEligible: hasAi,
    agentRevalidationEligible: hasAgents,
    mcpRevalidationEligible: hasMcp,
    memoryRevalidationEligible: hasMemory,
  };
}
