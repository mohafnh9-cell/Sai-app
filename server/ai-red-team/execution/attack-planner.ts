import { randomUUID } from "node:crypto";
import {
  ATTACK_DOMAINS,
  type ApplicationContext,
  type AttackDomain,
  type AttackPlan,
  type AttackPlanPhase,
} from "../types";

const DOMAIN_LABELS: Record<AttackDomain, string> = {
  authentication: "Authentication",
  authorization: "Authorization",
  browser: "Browser",
  api: "API",
  payments: "Payments",
  llm: "LLM",
};

/** Generic phase ordering — later phases may depend on earlier recon-style domains. */
const DEFAULT_DEPENDENCIES: Partial<Record<AttackDomain, AttackDomain[]>> = {
  authentication: ["browser"],
  api: ["authentication"],
  authorization: ["authentication", "api"],
  payments: ["authentication", "authorization"],
  llm: ["api"],
};

export type AttackPlannerInput = {
  context: ApplicationContext;
  scope?: AttackDomain[];
  /** Explicit phase order (Security Director: browser → authentication). */
  domainOrder?: AttackDomain[];
};

export class AttackPlanner {
  createPlan(input: AttackPlannerInput): AttackPlan {
    const domains = this.resolveDomains(input.scope, input.domainOrder);
    const phases: AttackPlanPhase[] = domains.map((domain) => ({
      id: `phase-${domain}`,
      domain,
      label: DOMAIN_LABELS[domain],
      agentIds: [],
      dependsOn: (DEFAULT_DEPENDENCIES[domain] ?? []).map((dep) => `phase-${dep}`),
    }));

    return {
      planId: randomUUID(),
      createdAt: new Date().toISOString(),
      phases,
      notes: [
        "RT1 generic plan — agent ids are assigned by the orchestrator from the registry.",
      ],
    };
  }

  private resolveDomains(scope?: AttackDomain[], domainOrder?: AttackDomain[]): AttackDomain[] {
    let selected: AttackDomain[];
    if (scope && scope.length > 0) {
      selected = domainOrder
        ? domainOrder.filter((d) => scope.includes(d))
        : ATTACK_DOMAINS.filter((domain) => scope.includes(domain));
    } else {
      selected = domainOrder ? [...domainOrder] : [...ATTACK_DOMAINS];
    }
    if (domainOrder && domainOrder.length > 0) {
      const orderIndex = new Map(domainOrder.map((d, i) => [d, i]));
      selected.sort((a, b) => (orderIndex.get(a) ?? 99) - (orderIndex.get(b) ?? 99));
    }
    return selected;
  }
}

export function createAttackPlanner(): AttackPlanner {
  return new AttackPlanner();
}
