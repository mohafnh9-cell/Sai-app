type TracePhase = "START" | "END" | "ERROR";

export type MissionControlTraceContext = {
  projectId?: string;
  runId?: string | null;
  scanId?: string | null;
  analysisRunId?: string | null;
  step?: string;
  [key: string]: unknown;
};

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const extra = error as Error & { digest?: string; cause?: unknown };
    return {
      name: extra.name,
      message: extra.message,
      stack: extra.stack,
      digest: extra.digest,
      cause:
        extra.cause instanceof Error
          ? { name: extra.cause.name, message: extra.cause.message, stack: extra.cause.stack }
          : extra.cause,
    };
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      raw: record,
      digest: record.digest,
      message: record.message,
    };
  }
  return { raw: String(error) };
}

/** Temporary structured trace for Mission Control server render diagnostics. */
export function missionControlTrace(
  step: string,
  phase: TracePhase,
  context: MissionControlTraceContext = {},
  error?: unknown
): void {
  const payload = {
    component: "mission-control-trace",
    step,
    phase,
    at: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nextRuntime: process.env.NEXT_RUNTIME ?? null,
    ...context,
  };

  if (phase === "ERROR") {
    console.error({
      ...payload,
      error: serializeError(error),
    });
    return;
  }

  console.info(payload);
}

/** Run an async step with START/END/ERROR logging. Does not swallow errors. */
export async function traceAwait<T>(
  step: string,
  context: MissionControlTraceContext,
  fn: () => Promise<T>
): Promise<T> {
  missionControlTrace(step, "START", context);
  try {
    const result = await fn();
    missionControlTrace(step, "END", context);
    return result;
  } catch (error) {
    missionControlTrace(step, "ERROR", context, error);
    throw error;
  }
}
