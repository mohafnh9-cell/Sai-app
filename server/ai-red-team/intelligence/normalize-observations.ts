import type { AttackResult } from "../types";
import type { NormalizedObservation } from "./models";

export function normalizeObservations(results: AttackResult[]): NormalizedObservation[] {
  const out: NormalizedObservation[] = [];
  for (const result of results) {
    for (const finding of result.findings) {
      const meta = finding.metadata ?? {};
      const correlationKeys = Array.isArray(meta.correlationKeys)
        ? (meta.correlationKeys as string[])
        : typeof meta.correlationKeys === "string"
          ? [meta.correlationKeys]
          : [];
      out.push({
        ...finding,
        team: (meta.team as string) ?? result.domain,
        specialist: meta.specialist as string | undefined,
        route: meta.route as string | undefined,
        correlationKeys,
        status: meta.status as string | undefined,
      });
    }
  }
  return out;
}

export function deduplicateObservations(observations: NormalizedObservation[]): NormalizedObservation[] {
  const seen = new Map<string, NormalizedObservation>();
  for (const obs of observations) {
    const key = `${obs.title}|${obs.route ?? ""}|${obs.domain}`;
    const existing = seen.get(key);
    if (!existing || obs.confidence > existing.confidence) {
      seen.set(key, obs);
    }
  }
  return [...seen.values()];
}
