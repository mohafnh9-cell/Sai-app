export type BusinessLogicPerformancePhases = {
  discoveryMs: number;
  domainModelMs: number;
  invariantsMs: number;
  abuseMs: number;
  specialistsMs: number;
  runtimeMs: number;
  findingsMs: number;
  correlationMs: number;
  persistenceMs: number;
  totalMs: number;
};

export type BusinessLogicPerformanceSnapshot = {
  phases: BusinessLogicPerformancePhases;
  heapUsedMb: number | null;
  specialistCount: number;
  findingCount: number;
  workflowCount: number;
};

export class BusinessLogicPerformanceTracker {
  private marks = new Map<string, number>();
  private phases: Partial<BusinessLogicPerformancePhases> = {};

  mark(phase: keyof BusinessLogicPerformancePhases): void {
    this.marks.set(phase, Date.now());
  }

  measure(from: keyof BusinessLogicPerformancePhases, to: keyof BusinessLogicPerformancePhases): number {
    const start = this.marks.get(from);
    const end = this.marks.get(to);
    if (start == null || end == null) return 0;
    const delta = Math.max(0, end - start);
    this.phases[from] = delta;
    return delta;
  }

  setPhase(phase: keyof BusinessLogicPerformancePhases, ms: number): void {
    this.phases[phase] = ms;
  }

  finalize(totalMs: number): BusinessLogicPerformanceSnapshot {
    const mem = typeof process !== "undefined" && process.memoryUsage ? process.memoryUsage().heapUsed : null;
    return {
      phases: {
        discoveryMs: this.phases.discoveryMs ?? 0,
        domainModelMs: this.phases.domainModelMs ?? 0,
        invariantsMs: this.phases.invariantsMs ?? 0,
        abuseMs: this.phases.abuseMs ?? 0,
        specialistsMs: this.phases.specialistsMs ?? 0,
        runtimeMs: this.phases.runtimeMs ?? 0,
        findingsMs: this.phases.findingsMs ?? 0,
        correlationMs: this.phases.correlationMs ?? 0,
        persistenceMs: this.phases.persistenceMs ?? 0,
        totalMs,
      },
      heapUsedMb: mem != null ? Math.round((mem / 1024 / 1024) * 100) / 100 : null,
      specialistCount: 0,
      findingCount: 0,
      workflowCount: 0,
    };
  }
}

export function attachCounts(
  snapshot: BusinessLogicPerformanceSnapshot,
  counts: { specialistCount: number; findingCount: number; workflowCount: number }
): BusinessLogicPerformanceSnapshot {
  return { ...snapshot, ...counts };
}
