import { BUILTIN_RULES } from "./builtin";
import { dependencyRule } from "./dependencies";
import { readinessAreasRule } from "./readiness-areas";
import type { ScanRule } from "./types";

export class RuleRegistry {
  private readonly rules = new Map<string, ScanRule>();

  constructor(rules: readonly ScanRule[] = []) {
    for (const rule of rules) this.register(rule);
  }

  register(rule: ScanRule): this {
    if (this.rules.has(rule.id)) throw new Error(`Duplicate security rule id: ${rule.id}`);
    this.rules.set(rule.id, rule);
    return this;
  }

  list(): ScanRule[] {
    return [...this.rules.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function createDefaultRegistry(): RuleRegistry {
  return new RuleRegistry([...BUILTIN_RULES, dependencyRule, readinessAreasRule]);
}
