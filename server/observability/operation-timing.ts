import "server-only";

import { percentileSummary } from "./metrics";

export type OperationName =
  | "mcp.tool"
  | "api.production_memory"
  | "api.protection_center"
  | "safe_fix.generate"
  | "safe_fix.verify"
  | "report.weekly"
  | "report.monthly"
  | "alert.evaluate"
  | "cp.daily"
  | "jobs.scan_run";

type TimingSample = {
  durationMs: number;
  at: number;
  meta?: Record<string, string | number | null>;
};

const MAX_SAMPLES_PER_OP = 2000;
const samples = new Map<OperationName, TimingSample[]>();

export function recordOperationDuration(
  operation: OperationName,
  durationMs: number,
  meta?: Record<string, string | number | null>
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const list = samples.get(operation) ?? [];
  list.push({ durationMs, at: Date.now(), meta });
  if (list.length > MAX_SAMPLES_PER_OP) {
    list.splice(0, list.length - MAX_SAMPLES_PER_OP);
  }
  samples.set(operation, list);
}

export function getOperationTimingSummaries(): Record<
  OperationName,
  ReturnType<typeof percentileSummary> & { lastMs: number | null }
> {
  const ops: OperationName[] = [
    "mcp.tool",
    "api.production_memory",
    "api.protection_center",
    "safe_fix.generate",
    "safe_fix.verify",
    "report.weekly",
    "report.monthly",
    "alert.evaluate",
    "cp.daily",
    "jobs.scan_run",
  ];
  const out = {} as Record<
    OperationName,
    ReturnType<typeof percentileSummary> & { lastMs: number | null }
  >;
  for (const op of ops) {
    const list = samples.get(op) ?? [];
    const durations = list.map((s) => s.durationMs);
    out[op] = {
      ...percentileSummary(durations),
      lastMs: list.length ? list[list.length - 1].durationMs : null,
    };
  }
  return out;
}

export async function withOperationTiming<T>(
  operation: OperationName,
  fn: () => Promise<T>,
  meta?: Record<string, string | number | null>
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    recordOperationDuration(operation, Date.now() - start, meta);
  }
}

export function resetOperationTimingsForTests(): void {
  samples.clear();
}
