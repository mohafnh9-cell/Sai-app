import type {
  AttackCost,
  AttackCostLevel,
  ThreatActorKind,
  ThreatFeasibility,
  ThreatPriority,
  ThreatCondition,
} from "./threat-model.types";
import type { CoreFindingConfidence } from "../core/confidence/confidence.types";

export type ThreatScoringConfidence = "high" | "medium" | "low";

export function coreConfidenceToScoringBand(confidence: CoreFindingConfidence): ThreatScoringConfidence {
  switch (confidence) {
    case "confirmed":
    case "highly_likely":
      return "high";
    case "likely":
      return "medium";
    case "possible":
    case "unsupported":
      return "low";
  }
}

function levelMax(...levels: AttackCostLevel[]): AttackCostLevel {
  const order: AttackCostLevel[] = ["trivial", "low", "moderate", "high", "prohibitive"];
  let max = 0;
  for (const l of levels) max = Math.max(max, order.indexOf(l));
  return order[max] ?? "moderate";
}

export function estimateAttackCost(input: {
  actorKind: ThreatActorKind;
  crossTeam: boolean;
  stepCount: number;
  detectionSurfaces: number;
}): AttackCost {
  const baseAccess: AttackCostLevel =
    input.actorKind === "anonymous_user"
      ? "low"
      : input.actorKind.startsWith("compromised")
        ? "moderate"
        : "high";
  const knowledge: AttackCostLevel = input.crossTeam ? "high" : "moderate";
  const complexity: AttackCostLevel =
    input.stepCount >= 5 ? "high" : input.stepCount >= 3 ? "moderate" : "low";
  const detection: AttackCostLevel =
    input.detectionSurfaces >= 3 ? "high" : input.detectionSurfaces >= 1 ? "moderate" : "low";

  return {
    requiredTime: levelMax(complexity, knowledge),
    requiredKnowledge: knowledge,
    requiredAccess: baseAccess,
    requiredResources: input.crossTeam ? "moderate" : "low",
    requiredPrivileges: baseAccess,
    interactionComplexity: complexity,
    detectionRisk: detection,
    reproducibility: complexity === "high" ? "low" : "moderate",
    automationPotential: input.actorKind.includes("compromised") ? "moderate" : "low",
    explainability: [
      `Actor ${input.actorKind} access band ${baseAccess}`,
      `Steps ${input.stepCount}`,
      input.crossTeam ? "Cross-team correlation required" : "Single-team path",
    ],
  };
}

export function classifyFeasibility(input: {
  conditions: ThreatCondition[];
  hasUnsupportedPreconditions: boolean;
  evidenceConfidence: ThreatScoringConfidence;
  attackCost: AttackCost;
}): ThreatFeasibility {
  if (input.hasUnsupportedPreconditions) return "blocked";
  if (input.conditions.some((c) => c.blocking && !c.satisfied)) return "blocked";
  const costly =
    input.attackCost.requiredKnowledge === "prohibitive" ||
    input.attackCost.requiredAccess === "prohibitive";
  if (costly) return "unlikely";
  if (input.evidenceConfidence === "low") return "conditional";
  if (input.attackCost.interactionComplexity === "high") return "conditional";
  if (input.evidenceConfidence === "high" && input.attackCost.detectionRisk !== "prohibitive") {
    return "highly_feasible";
  }
  return "feasible";
}

export function classifyPriority(input: {
  feasibility: ThreatFeasibility;
  assetCriticality: "critical" | "high" | "medium" | "low";
  businessImpact: "critical" | "high" | "medium" | "low";
  confidence: ThreatScoringConfidence;
  crossTeam: boolean;
}): ThreatPriority {
  if (input.feasibility === "blocked") return "informational";
  if (input.feasibility === "unlikely") return "low";
  if (input.assetCriticality === "critical" && input.feasibility !== "conditional") return "critical";
  if (input.businessImpact === "critical" || (input.crossTeam && input.confidence === "high")) {
    return "high";
  }
  if (input.feasibility === "conditional") return "medium";
  return input.confidence === "high" ? "high" : "medium";
}
