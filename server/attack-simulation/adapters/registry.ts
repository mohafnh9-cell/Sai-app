import { ATTACK_ADAPTER_CATALOG } from "../planner/adapter-catalog";
import { MVP_ATTACK_ADAPTER_MODULES } from "./mvp-modules";
import type { AttackAdapterModule } from "./types";

const MODULES_BY_ID = new Map<string, AttackAdapterModule>(
  MVP_ATTACK_ADAPTER_MODULES.map((module) => [module.id, module])
);

export function resolveAttackAdapterModule(adapterId: string): AttackAdapterModule | undefined {
  return MODULES_BY_ID.get(adapterId);
}

export function listAttackAdapterModules(): AttackAdapterModule[] {
  return [...MODULES_BY_ID.values()];
}

export function assertMvpAdapterModulesComplete(): string[] {
  const missing = ATTACK_ADAPTER_CATALOG.filter((adapter) => !MODULES_BY_ID.has(adapter.id)).map(
    (adapter) => adapter.id
  );
  return missing;
}
