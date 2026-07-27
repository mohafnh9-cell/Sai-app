import { randomUUID } from "node:crypto";
import type { FindingCorrelationGroup, NormalizedObservation } from "./models";

function groupByKey(
  observations: NormalizedObservation[],
  keyFn: (o: NormalizedObservation) => string | null
): Map<string, NormalizedObservation[]> {
  const map = new Map<string, NormalizedObservation[]>();
  for (const obs of observations) {
    const key = keyFn(obs);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(obs);
    map.set(key, list);
  }
  return map;
}

export function correlateFindings(observations: NormalizedObservation[]): FindingCorrelationGroup[] {
  const groups: FindingCorrelationGroup[] = [];

  for (const [key, list] of groupByKey(observations, (o) =>
    o.correlationKeys.length > 0 ? o.correlationKeys.sort().join("|") : null
  )) {
    if (list.length < 2) continue;
    groups.push({
      id: randomUUID(),
      kind: list.every((f) => f.title === list[0]?.title) ? "duplicate" : "attack_chain",
      findingIds: list.map((f) => f.id),
      confidence: Math.min(0.95, 0.55 + list.length * 0.12),
      rationale: `Findings share correlation context "${key}"`,
    });
  }

  for (const [route, list] of groupByKey(observations, (o) => o.route ?? null)) {
    if (list.length < 2) continue;
    if (groups.some((g) => g.findingIds.length === list.length && list.every((f) => g.findingIds.includes(f.id)))) {
      continue;
    }
    const sessionLike = list.filter((f) =>
      /session|cookie|storage|auth/i.test(`${f.title} ${f.correlationKeys.join(" ")}`)
    );
    if (sessionLike.length >= 2) {
      groups.push({
        id: randomUUID(),
        kind: "attack_chain",
        findingIds: sessionLike.map((f) => f.id),
        confidence: 0.78,
        rationale: `Multiple session-related signals on route ${route}`,
      });
    } else {
      groups.push({
        id: randomUUID(),
        kind: "same_issue",
        findingIds: list.map((f) => f.id),
        confidence: 0.65,
        rationale: `Findings observed on the same route ${route}`,
      });
    }
  }

  for (const obs of observations) {
    const supporting = observations.filter(
      (other) =>
        other.id !== obs.id &&
        other.domain === obs.domain &&
        other.route === obs.route &&
        other.severity === "low" &&
        obs.severity !== "low"
    );
    if (supporting.length === 0) continue;
    groups.push({
      id: randomUUID(),
      kind: "supporting_evidence",
      findingIds: [obs.id, ...supporting.map((s) => s.id)],
      confidence: 0.7,
      rationale: "Higher-severity finding supported by related observations",
    });
  }

  const independent = observations.filter(
    (o) => !groups.some((g) => g.findingIds.includes(o.id) && g.kind !== "supporting_evidence")
  );
  if (independent.length > 0) {
    groups.push({
      id: randomUUID(),
      kind: "independent",
      findingIds: independent.map((o) => o.id),
      confidence: 0.5,
      rationale: "Findings with no strong correlation to other observations",
    });
  }

  return groups;
}
