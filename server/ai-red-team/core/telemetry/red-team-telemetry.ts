import type { CoreTelemetryContext } from "../telemetry/telemetry.types";

export type RedTeamTelemetryEventName =
  | "pipeline.started"
  | "pipeline.completed"
  | "pipeline.failed"
  | "stage.started"
  | "stage.completed"
  | "stage.failed"
  | "capability.resolution"
  | "manifest.validation"
  | "specialist.selection"
  | "runtime.execution"
  | "budget.exhausted"
  | "finding.created"
  | "finding.correlated"
  | "replay.generated"
  | "integration.delivery";

export type RedTeamTelemetryEvent = {
  name: RedTeamTelemetryEventName;
  organizationId: string;
  projectId: string;
  scanId: string;
  executionId: string;
  correlationId: string;
  redTeamId: string;
  stageId: string;
  durationMs: number;
  status: "ok" | "error" | "skipped";
  version: string;
  metadata?: Record<string, string | number | boolean>;
};

const FORBIDDEN_METADATA_KEYS = [
  "prompt",
  "token",
  "secret",
  "credential",
  "password",
  "apikey",
  "authorization",
  "customercontent",
];

export function buildRedTeamTelemetryEvent(input: {
  name: RedTeamTelemetryEventName;
  context: CoreTelemetryContext;
  redTeamId: string;
  stageId: string;
  durationMs: number;
  status: RedTeamTelemetryEvent["status"];
  version: string;
  metadata?: Record<string, string | number | boolean>;
}): RedTeamTelemetryEvent {
  const safeMeta: Record<string, string | number | boolean> = {};
  if (input.metadata) {
    for (const [key, value] of Object.entries(input.metadata).sort(([a], [b]) => a.localeCompare(b))) {
      const lower = key.toLowerCase();
      if (FORBIDDEN_METADATA_KEYS.some((f) => lower.includes(f))) continue;
      if (typeof value === "string" && value.length > 512) continue;
      safeMeta[key] = value;
    }
  }
  return {
    name: input.name,
    organizationId: input.context.organizationId,
    projectId: input.context.projectId,
    scanId: input.context.scanId,
    executionId: input.context.executionId,
    correlationId: input.context.correlationId,
    redTeamId: input.redTeamId,
    stageId: input.stageId,
    durationMs: input.durationMs,
    status: input.status,
    version: input.version,
    metadata: Object.keys(safeMeta).length ? safeMeta : undefined,
  };
}

export type TelemetrySink = (event: RedTeamTelemetryEvent) => void | Promise<void>;

/** Non-critical telemetry — failures must not fail scans. */
export async function emitRedTeamTelemetry(
  sink: TelemetrySink | undefined,
  event: RedTeamTelemetryEvent
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // swallow — resilience requirement
  }
}
