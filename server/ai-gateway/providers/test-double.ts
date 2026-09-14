import "server-only";

import type { AiProviderClient, StructuredReasoningRequest } from "../types";

/**
 * Phase 37, section 32: a deterministic AI-provider test double implementing
 * the EXACT same AiProviderClient interface real providers do -- used for
 * CI so tests never depend on network access or a live API key, and so the
 * gateway's own validation logic (schema + evidence-reference checking) can
 * be exercised deterministically, including its rejection paths.
 */
export function createTestDoubleProvider(rawTextOverride?: string): AiProviderClient {
  return {
    id: "test-double",
    async generateStructured(request: StructuredReasoningRequest) {
      if (rawTextOverride !== undefined) {
        return { rawText: rawTextOverride, usage: { inputTokens: 0, outputTokens: 0 } };
      }
      // Default: a well-formed, schema-valid, evidence-honest response
      // referencing only whatever finding ids appear in the prompt.
      const findingIdMatches = [...request.userPrompt.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
      const firstId = findingIdMatches[0];
      const payload = {
        summary: firstId
          ? `Reviewed ${findingIdMatches.length} finding(s). The most significant is ${firstId}.`
          : "No findings were provided to reason about.",
        prioritizedFindings: firstId
          ? [{ findingId: firstId, evidenceIds: [], reason: "Highest severity finding in the provided evidence.", confidence: "SUPPORTED" }]
          : [],
        attackChainAssessments: [],
        architectureObservations: [],
        investigationRecommendations: [],
        remediationRecommendations: [],
        confidence: "SUPPORTED",
        evidenceReferences: firstId ? [firstId] : [],
      };
      return { rawText: JSON.stringify(payload), usage: { inputTokens: 100, outputTokens: 100 } };
    },
  };
}
