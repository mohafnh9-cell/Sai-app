import type { AttackChain, BusinessImpactAssessment, NormalizedObservation, PrioritizedRemediation, RemediationPriority } from "./models";

function exploitabilityWeight(obs: NormalizedObservation): number {
  const meta = obs.metadata ?? {};
  const exploit = meta.exploitability as string | undefined;
  if (exploit === "high") return 1.2;
  if (exploit === "medium") return 1;
  if (exploit === "low") return 0.7;
  return 0.5;
}

function priorityFromScore(score: number): RemediationPriority {
  if (score >= 8) return "fix_immediately";
  if (score >= 6) return "fix_before_production";
  if (score >= 3.5) return "fix_this_sprint";
  if (score >= 1.5) return "monitor";
  return "accepted_risk";
}

export function rankRemediationPriorities(input: {
  observations: NormalizedObservation[];
  impacts: BusinessImpactAssessment[];
  chains: AttackChain[];
}): PrioritizedRemediation[] {
  const impactByFinding = new Map(input.impacts.map((i) => [i.findingId, i]));
  const chainByFinding = new Map<string, AttackChain>();
  for (const chain of input.chains) {
    for (const id of chain.findingIds) chainByFinding.set(id, chain);
  }

  const priorities = input.observations.map((obs) => {
    const impact = impactByFinding.get(obs.id);
    const chain = chainByFinding.get(obs.id);
    const severityWeight = { info: 0.5, low: 1, medium: 2, high: 3.5, critical: 5 }[obs.severity] ?? 1;
    const deploymentWeight = impact
      ? { none: 0, low: 0.5, medium: 1, high: 2 }[impact.deploymentImpact]
      : 0.5;
    const chainWeight = chain ? chain.score / 5 : 0;
    const score =
      severityWeight * 1.2 +
      obs.confidence * 2 +
      exploitabilityWeight(obs) +
      deploymentWeight +
      chainWeight;

    let rationale = "Ranked by severity, confidence, and deployment impact.";
    if (chain) rationale = `Part of attack chain "${chain.summary}" — fixing early reduces combined risk.`;

    return {
      findingId: obs.id,
      priority: priorityFromScore(score),
      score: Math.round(score * 100) / 100,
      rationale,
      chainId: chain?.id ?? null,
    };
  });

  return priorities.sort((a, b) => b.score - a.score);
}
