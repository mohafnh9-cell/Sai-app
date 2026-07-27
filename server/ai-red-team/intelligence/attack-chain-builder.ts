import { randomUUID } from "node:crypto";
import type { AttackChain, FindingCorrelationGroup, IntelligenceAttackGraph, NormalizedObservation } from "./models";

const SESSION_PATTERNS = /session|cookie|localstorage|storage|auth/i;
const PRIV_PATTERNS = /admin|privilege|escalation|authorization/i;
const PAY_PATTERNS = /payment|stripe|billing|subscription/i;

function severityScore(severity: NormalizedObservation["severity"]): number {
  return { info: 1, low: 2, medium: 3, high: 4, critical: 5 }[severity] ?? 2;
}

function chainSeverity(score: number): AttackChain["severity"] {
  if (score >= 12) return "critical";
  if (score >= 9) return "high";
  if (score >= 5) return "medium";
  return "low";
}

export function buildAttackChains(input: {
  observations: NormalizedObservation[];
  correlations: FindingCorrelationGroup[];
  graph: IntelligenceAttackGraph;
}): AttackChain[] {
  const chains: AttackChain[] = [];
  const byId = new Map(input.observations.map((o) => [o.id, o]));

  for (const group of input.correlations) {
    if (group.kind !== "attack_chain" && group.kind !== "possible_exploit_path") continue;
    const findings = group.findingIds.map((id) => byId.get(id)).filter(Boolean) as NormalizedObservation[];
    if (findings.length < 2) continue;
    const score = findings.reduce((sum, f) => sum + severityScore(f.severity), 0);
    chains.push({
      id: randomUUID(),
      steps: findings.map((f) => ({
        findingId: f.id,
        nodeId: `finding:${f.id}`,
        label: f.title,
      })),
      severity: chainSeverity(score),
      score,
      findingIds: findings.map((f) => f.id),
      summary: `Correlated chain across ${findings.length} findings (${group.rationale})`,
    });
  }

  const sessionFindings = input.observations.filter((o) => SESSION_PATTERNS.test(o.title));
  const privFindings = input.observations.filter((o) => PRIV_PATTERNS.test(o.title));
  const payFindings = input.observations.filter((o) => PAY_PATTERNS.test(o.title));
  const hasAdminNode = input.graph.nodes.some((n) => n.id === "privilege:admin" || n.kind === "privilege");
  const hasPayment = input.graph.nodes.some((n) => n.kind === "payment");

  if (sessionFindings.length > 0 && (privFindings.length > 0 || hasAdminNode)) {
    const steps = [
      ...sessionFindings.slice(0, 1).map((f) => ({
        findingId: f.id,
        nodeId: `finding:${f.id}`,
        label: f.title,
      })),
      {
        findingId: privFindings[0]?.id ?? null,
        nodeId: hasAdminNode ? "privilege:admin" : `finding:${privFindings[0]?.id}`,
        label: privFindings[0]?.title ?? "Privilege escalation surface",
      },
    ];
    if (hasPayment || payFindings.length > 0) {
      steps.push({
        findingId: payFindings[0]?.id ?? null,
        nodeId: hasPayment ? "payment:stripe" : `finding:${payFindings[0]?.id}`,
        label: payFindings[0]?.title ?? "Payment configuration exposure",
      });
    }
    const findingIds = steps.map((s) => s.findingId).filter(Boolean) as string[];
    const score = findingIds.reduce((sum, id) => sum + severityScore(byId.get(id)?.severity ?? "medium"), 0) + 3;
    chains.push({
      id: randomUUID(),
      steps,
      severity: chainSeverity(score),
      score,
      findingIds,
      summary: "Session weakness may enable privilege escalation toward sensitive business functions",
    });
  }

  return chains.sort((a, b) => b.score - a.score);
}
