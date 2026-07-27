import type { MemoryLink, NormalizedObservation, ProductionMemorySnapshot } from "./models";

const FIX_EVENT_TYPES = new Set([
  "safe_fix_generated",
  "fix_verified",
  "browser_finding_confirmed",
  "protection_review_completed",
]);

export function linkFindingsToMemory(
  observations: NormalizedObservation[],
  memory?: ProductionMemorySnapshot | null
): MemoryLink[] {
  if (!memory?.events?.length) {
    return observations.map((obs) => ({
      findingId: obs.id,
      linkedEventTypes: [],
      previouslyFixed: false,
      regressed: false,
      note: null,
    }));
  }

  return observations.map((obs) => {
    const keys = new Set([obs.title.toLowerCase(), ...(obs.correlationKeys ?? []).map((k) => k.toLowerCase())]);
    const linked = memory.events.filter((event) => {
      const payload = JSON.stringify(event.payload).toLowerCase();
      return [...keys].some((k) => k.length > 3 && payload.includes(k));
    });

    const linkedEventTypes = [...new Set(linked.map((e) => e.type))];
    const previouslyFixed = linked.some((e) => FIX_EVENT_TYPES.has(e.type));
    const regressed = previouslyFixed && obs.severity !== "info";

    let note: string | null = null;
    if (regressed) note = "Similar issue appeared in memory after a prior fix or review.";
    else if (previouslyFixed) note = "Related remediation activity exists in Production Memory.";

    return {
      findingId: obs.id,
      linkedEventTypes,
      previouslyFixed,
      regressed,
      note,
    };
  });
}
