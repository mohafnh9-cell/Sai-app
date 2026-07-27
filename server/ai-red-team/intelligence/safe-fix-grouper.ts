import { randomUUID } from "node:crypto";
import type { AttackChain, GroupedSafeFixPlan, NormalizedObservation, PrioritizedRemediation } from "./models";

export function groupSafeFixPlans(input: {
  observations: NormalizedObservation[];
  chains: AttackChain[];
  priorities: PrioritizedRemediation[];
}): GroupedSafeFixPlan[] {
  const plans: GroupedSafeFixPlan[] = [];
  const used = new Set<string>();

  for (const chain of input.chains) {
    const eligible = chain.findingIds.filter((id) => {
      const obs = input.observations.find((o) => o.id === id);
      return obs?.metadata?.safeFixEligible !== false;
    });
    if (eligible.length === 0) continue;
    eligible.forEach((id) => used.add(id));
    const top = input.observations.find((o) => o.id === eligible[0]);
    plans.push({
      id: randomUUID(),
      title: top ? `Resolve chain starting at ${top.title}` : "Resolve correlated attack chain",
      findingIds: eligible,
      chainId: chain.id,
      remediationSummary:
        top?.metadata?.remediationDirection?.toString() ??
        top?.description ??
        "Address the root session or access-control weakness first.",
      estimatedFindingsResolved: eligible.length,
    });
  }

  for (const priority of input.priorities) {
    if (used.has(priority.findingId)) continue;
    const obs = input.observations.find((o) => o.id === priority.findingId);
    if (!obs || obs.metadata?.safeFixEligible === false) continue;
    if (priority.priority === "monitor" || priority.priority === "accepted_risk") continue;
    used.add(obs.id);
    plans.push({
      id: randomUUID(),
      title: obs.title,
      findingIds: [obs.id],
      chainId: priority.chainId ?? null,
      remediationSummary:
        obs.metadata?.remediationDirection?.toString() ?? obs.description ?? "Apply targeted remediation.",
      estimatedFindingsResolved: 1,
    });
  }

  return plans;
}
