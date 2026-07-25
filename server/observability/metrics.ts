import type { MetricCounterName } from "./types";
import { METRIC_COUNTERS } from "./types";

const counters = new Map<MetricCounterName, number>();

export function incrementMetricCounter(name: MetricCounterName, amount = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + amount);
}

export function getMetricCounters(): Record<MetricCounterName, number> {
  const result = {} as Record<MetricCounterName, number>;
  for (const name of METRIC_COUNTERS) {
    result[name] = counters.get(name) ?? 0;
  }
  return result;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function percentileSummary(values: number[]) {
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    count: values.length,
  };
}

export function resetMetricCountersForTests(): void {
  counters.clear();
}
