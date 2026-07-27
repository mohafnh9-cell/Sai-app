import { randomUUID } from "node:crypto";
import type { AttackSeverity } from "../../types/attack-models";
import type { AttackCampaign, AttackCampaignStep } from "../fix-strategy.types";
import type { SecurityIntelligenceReport } from "../../intelligence/models";

export function buildAttackCampaignFromIntelligence(
  intelligence: SecurityIntelligenceReport,
  goal = "Compromise application"
): AttackCampaign {
  const chain = [...intelligence.attackChains].sort((a, b) => b.score - a.score)[0];
  if (chain) {
    const steps: AttackCampaignStep[] = chain.steps.map((s) => ({
      label: s.label,
      findingId: s.findingId,
    }));
    return {
      campaignId: chain.id,
      goal,
      steps,
      findingIds: chain.findingIds,
      severity: chain.severity,
      source: "attack_chain",
    };
  }

  const findings = intelligence.deduplicatedFindings;
  const steps: AttackCampaignStep[] = findings.slice(0, 8).map((f) => ({
    label: f.title,
    findingId: f.id,
  }));
  const maxSeverity = findings.reduce<{ rank: number; sev: AttackSeverity }>(
    (max, f) => {
      const rank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[f.severity] ?? 0;
      return rank > max.rank ? { rank, sev: f.severity } : max;
    },
    { rank: 0, sev: "info" },
  );

  return {
    campaignId: randomUUID(),
    goal,
    steps,
    findingIds: findings.map((f) => f.id),
    severity:
      maxSeverity.sev === "info" ? "low" : maxSeverity.sev,
    source: "synthesized",
  };
}

/** RT11 forward-compatible entry point. */
export function buildAttackCampaignFromRt11(input: {
  campaignId: string;
  goal: string;
  steps: AttackCampaignStep[];
  severity: AttackCampaign["severity"];
}): AttackCampaign {
  return {
    campaignId: input.campaignId,
    goal: input.goal,
    steps: input.steps,
    findingIds: input.steps.map((s) => s.findingId).filter(Boolean) as string[],
    severity: input.severity,
    source: "rt11",
  };
}
