import type { AttackResult } from "../../types";
import type { BusinessLogicPlatformPayload } from "./platform-payload";
import type { BusinessLogicIntelligenceBundle } from "./platform-payload";

export function readBusinessLogicPlatformPayload(
  result: AttackResult
): BusinessLogicPlatformPayload | null {
  const raw = result.metadata?.businessLogicPlatform;
  if (!raw || typeof raw !== "object") return null;
  return raw as BusinessLogicPlatformPayload;
}

export function extractBusinessLogicIntelligenceFromResults(
  results: AttackResult[]
): BusinessLogicIntelligenceBundle | null {
  const blResult = results.find((r) => r.agentId === "logic.business");
  if (!blResult) return null;
  const payload = readBusinessLogicPlatformPayload(blResult);
  if (!payload) return null;
  return {
    findingSummary: payload.findingSummary,
    riskSummary: payload.riskSummary,
    evidenceSummary: payload.evidenceSummary,
    coverage: payload.coverage,
    confidence: payload.confidence,
    riskAreas: payload.riskAreas,
    executionSummary: payload.executionSummary,
    replaySummary: payload.replaySummary,
    decisionExposure: payload.decisionExposure,
  };
}

export function collectBusinessLogicReplayPlansFromResult(result: AttackResult): Array<{
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
      return { replayPlanId, findingId, team: "payments" };
    })
    .filter(Boolean) as Array<{ replayPlanId: string; findingId: string; team: string }>;
}

export function buildBusinessLogicDecisionExposure(
  payload: BusinessLogicPlatformPayload | null
): BusinessLogicPlatformPayload["decisionExposure"] | null {
  return payload?.decisionExposure ?? null;
}

export function buildBusinessLogicUeeRemediationInputs(
  payload: BusinessLogicPlatformPayload | null
): BusinessLogicPlatformPayload["ueeRemediationInputs"] {
  return payload?.ueeRemediationInputs ?? [];
}

export function buildBusinessLogicAsoHints(
  payload: BusinessLogicPlatformPayload | null
): BusinessLogicPlatformPayload["asoOrchestration"] | null {
  return payload?.asoOrchestration ?? null;
}
