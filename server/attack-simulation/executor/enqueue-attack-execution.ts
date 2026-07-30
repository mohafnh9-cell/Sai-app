import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/inngest/client";
import { INNGEST_EVENTS } from "@/inngest/events";
import {
  buildAttackExecutionRunPayload,
  type AttackExecutionRunPayload,
} from "./inngest-payload";
import { executeAttackExecution } from "./execution-service";

export class AttackExecutionEnqueueError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "AttackExecutionEnqueueError";
  }
}

export function isAttackExecutionInngestEnabled(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);
}

export async function sendAttackExecutionRunEvent(
  payload: AttackExecutionRunPayload
): Promise<string[]> {
  if (!isAttackExecutionInngestEnabled()) {
    throw new AttackExecutionEnqueueError(
      "INNGEST_NOT_CONFIGURED",
      "Inngest is not configured for attack execution runs"
    );
  }

  const parsed = buildAttackExecutionRunPayload(payload);
  const result = await inngest.send({
    name: INNGEST_EVENTS.ATTACK_EXECUTION_RUN,
    data: parsed,
    id: parsed.idempotencyKey ?? `${parsed.organizationId}:${parsed.executionId}`,
  });

  return result.ids ?? [];
}

export async function enqueueAttackExecutionRun(
  admin: SupabaseClient,
  payload: AttackExecutionRunPayload
): Promise<{ executor: "inngest" | "inline"; inngestEventId: string | null }> {
  if (isAttackExecutionInngestEnabled()) {
    const ids = await sendAttackExecutionRunEvent(payload);
    if (ids.length === 0) {
      throw new AttackExecutionEnqueueError(
        "ENQUEUE_FAILED",
        "Inngest did not return an event id for attack/execution.run"
      );
    }
    return { executor: "inngest", inngestEventId: ids[0] ?? null };
  }

  await executeAttackExecution(admin, {
    organizationId: payload.organizationId,
    executionId: payload.executionId,
    targetUrl: payload.targetUrl ?? null,
  });

  return { executor: "inline", inngestEventId: null };
}
