import type { AttackResult } from "../../types";
import type { LlmPlatformPayload, LlmIntelligenceBundle } from "./platform-payload";

export function readLlmPlatformPayload(result: AttackResult): LlmPlatformPayload | null {
  const raw = result.metadata?.llmPlatform;
  if (!raw || typeof raw !== "object") return null;
  return raw as LlmPlatformPayload;
}

export function extractLlmIntelligenceFromResults(results: AttackResult[]): LlmIntelligenceBundle | null {
  const llmResult = results.find((r) => r.agentId === "ai.llm");
  if (!llmResult) return null;
  const payload = readLlmPlatformPayload(llmResult);
  if (!payload) return null;
  return {
    findingSummary: payload.findingSummary,
    trustSummary: payload.trustSummary,
    riskSummary: payload.riskSummary,
    coverage: payload.coverage,
    executionCoverage: payload.executionCoverage,
    invariantCoverage: payload.invariantCoverage,
    layerCoverage: payload.layerCoverage,
    protectedAssetSummary: payload.protectedAssetSummary,
    attackPreconditionsSummary: payload.attackPreconditionsSummary,
    executionStatistics: payload.executionStatistics,
    replaySummary: payload.replaySummary,
    decisionExposure: payload.decisionExposure,
  };
}

export function collectLlmReplayPlansFromResult(result: AttackResult): Array<{
  replayPlanId: string;
  findingId: string;
  team: string;
}> {
  const raw = result.metadata?.replayPlans;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const plan = entry as Record<string, unknown>;
      const replayPlanId = String(plan.replayPlanId ?? plan.id ?? "");
      const findingId = String(plan.findingId ?? "");
      if (!replayPlanId) return null;
      return { replayPlanId, findingId, team: "llm" };
    })
    .filter(Boolean) as Array<{ replayPlanId: string; findingId: string; team: string }>;
}

export function buildLlmDecisionExposure(
  payload: LlmPlatformPayload | null
): LlmPlatformPayload["decisionExposure"] | null {
  return payload?.decisionExposure ?? null;
}

export function buildLlmUeeRemediationInputs(
  payload: LlmPlatformPayload | null
): LlmPlatformPayload["ueeRemediationInputs"] {
  return payload?.ueeRemediationInputs ?? [];
}

export function buildLlmAsoHints(
  payload: LlmPlatformPayload | null
): LlmPlatformPayload["asoOrchestration"] | null {
  return payload?.asoOrchestration ?? null;
}

export function readCanonicalAttackPreconditionsFromResult(
  result: AttackResult
): LlmPlatformPayload["attackPreconditionsSummary"] | null {
  const payload = readLlmPlatformPayload(result);
  return payload?.attackPreconditionsSummary ?? null;
}
