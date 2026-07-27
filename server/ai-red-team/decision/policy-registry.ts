import type { DecisionPolicy } from "./decision-policy";
import { createDefaultDecisionPolicies } from "./policies/default-policies";

export class DecisionPolicyRegistry {
  private readonly policies: DecisionPolicy[] = [];

  register(policy: DecisionPolicy): void {
    if (this.policies.some((p) => p.id === policy.id)) {
      throw new Error(`Policy already registered: ${policy.id}`);
    }
    this.policies.push(policy);
  }

  registerMany(policies: DecisionPolicy[]): void {
    for (const policy of policies) this.register(policy);
  }

  list(): DecisionPolicy[] {
    return [...this.policies];
  }
}

export function createDefaultPolicyRegistry(): DecisionPolicyRegistry {
  const registry = new DecisionPolicyRegistry();
  registry.registerMany(createDefaultDecisionPolicies());
  return registry;
}
