import { inngest } from "@/inngest/client";
import { INNGEST_EVENTS } from "@/inngest/events";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { executeAttackExecution } from "@/server/attack-simulation/executor/execution-service";
import { parseAttackExecutionRunInngestEvent } from "@/server/attack-simulation/executor/inngest-payload";
import {
  ATTACK_EXECUTION_ORG_CONCURRENCY_LIMIT,
  ATTACK_EXECUTION_TIMEOUT_MS,
} from "@/server/attack-simulation/executor/types";

export const attackExecutionRunFunction = inngest.createFunction(
  {
    id: "attack-execution-run",
    name: "Run attack simulation execution",
    retries: 2,
    timeouts: { finish: `${Math.floor(ATTACK_EXECUTION_TIMEOUT_MS / 60000)}m` },
    concurrency: {
      limit: ATTACK_EXECUTION_ORG_CONCURRENCY_LIMIT,
      key: "event.data.organizationId",
    },
    idempotency: "event.data.idempotencyKey",
  },
  { event: INNGEST_EVENTS.ATTACK_EXECUTION_RUN },
  async ({ event, attempt, runId }) => {
    const admin = createAdminClient();
    let payload;
    try {
      payload = parseAttackExecutionRunInngestEvent(event.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid attack/execution.run payload";
      console.error({
        component: "inngest-attack-execution-run",
        event: "payload_invalid",
        message,
      });
      throw error;
    }

    console.info({
      component: "inngest-attack-execution-run",
      event: "worker_started",
      executionId: payload.executionId,
      campaignId: payload.campaignId,
      inngestRunId: runId,
      attempt,
    });

    const result = await executeAttackExecution(admin, {
      organizationId: payload.organizationId,
      executionId: payload.executionId,
      targetUrl: payload.targetUrl ?? null,
    });

    if (!result.ok) {
      throw new Error(`${result.failureCode}: ${result.safeFailureMessage}`);
    }

    return {
      skipped: result.skipped,
      executionId: result.execution.id,
      status: result.execution.status,
      stepCount: result.skipped ? 0 : result.stepCount,
    };
  }
);
