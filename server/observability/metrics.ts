import type { MetricCounterName } from "./types";

const counters = new Map<MetricCounterName, number>();

export function incrementMetricCounter(name: MetricCounterName, amount = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + amount);
}

export function getMetricCounters(): Record<MetricCounterName, number> {
  return {
    jobs_created_total: counters.get("jobs_created_total") ?? 0,
    jobs_completed_total: counters.get("jobs_completed_total") ?? 0,
    jobs_failed_total: counters.get("jobs_failed_total") ?? 0,
    jobs_retried_total: counters.get("jobs_retried_total") ?? 0,
    jobs_timed_out_total: counters.get("jobs_timed_out_total") ?? 0,
    jobs_recovered_total: counters.get("jobs_recovered_total") ?? 0,
    duplicate_webhooks_total: counters.get("duplicate_webhooks_total") ?? 0,
    duplicate_scans_prevented_total: counters.get("duplicate_scans_prevented_total") ?? 0,
    notification_failures_total: counters.get("notification_failures_total") ?? 0,
    stuck_jobs_total: counters.get("stuck_jobs_total") ?? 0,
  };
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
