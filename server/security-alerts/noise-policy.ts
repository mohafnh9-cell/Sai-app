import type { AlertCandidate, AlertSeverity } from "./types";

const COOLDOWN_HOURS: Partial<Record<string, number>> = {
  deploy_blocked: 24,
  protection_status_regression: 24,
  confidence_cliff: 24,
  production_confidence_drop: 24,
  security_confidence_drop: 24,
  material_finding_critical: 24,
};

/** Low severity never becomes a founder alert (Memory-only). */
export function shouldDeliverAlert(candidate: AlertCandidate): boolean {
  if (candidate.severity === "low") return false;
  if (candidate.deliveryTier === "digest" && candidate.severity === "medium") {
    return candidate.alertKind === "deploy_blocked";
  }
  return candidate.deliveryTier === "immediate" || candidate.alertKind === "deploy_blocked";
}

export function cooldownUntil(candidate: AlertCandidate, from = new Date()): Date | null {
  const hours = candidate.cooldownHours ?? COOLDOWN_HOURS[candidate.alertKind] ?? 24;
  if (hours <= 0) return null;
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

export function isWithinCooldown(cooldownUntilIso: string | null): boolean {
  if (!cooldownUntilIso) return false;
  return new Date(cooldownUntilIso).getTime() > Date.now();
}

/** Material gate: suppress when nothing changed that affects founder action. */
export function passesMaterialGate(input: {
  hasMaterialEvent24h: boolean;
  statusRequiresAttention: boolean;
  openCritical: number;
  confidenceDrop24h: number | null;
}): boolean {
  if (input.openCritical > 0 && input.hasMaterialEvent24h) return true;
  if (input.statusRequiresAttention && input.hasMaterialEvent24h) return true;
  if (input.confidenceDrop24h != null && input.confidenceDrop24h >= 10) return true;
  return input.hasMaterialEvent24h;
}

export function duplicateSuppressionReason(existingDedupeKey: boolean, inCooldown: boolean): string | null {
  if (existingDedupeKey) return "duplicate_dedupe_key";
  if (inCooldown) return "cooldown_active";
  return null;
}

export function sortAlertsByPriority<T extends { severity: AlertSeverity; priority: number }>(
  rows: T[]
): T[] {
  const rank: Record<AlertSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return [...rows].sort((a, b) => {
    const sr = rank[a.severity] - rank[b.severity];
    if (sr !== 0) return sr;
    return a.priority - b.priority;
  });
}
