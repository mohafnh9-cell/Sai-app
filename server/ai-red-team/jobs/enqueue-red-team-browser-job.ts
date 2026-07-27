import "server-only";

import { randomUUID } from "node:crypto";
import type { AttackRequest } from "../types";
import type { AttackAuthorizationRecord } from "../authorization";
import { createBrowserEnabledRedTeamEngine } from "../index";
import { createSupabaseRedTeamRunStore } from "../runs/supabase-red-team-run-store";
import { executeQueuedRedTeamRun } from "../runs/request-red-team-run";
import { recordBrowserSimulationMemory } from "../teams/browser/production-memory";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function enqueueRedTeamBrowserJob(
  admin: SupabaseClient,
  input: {
    request: AttackRequest;
    targetUrl: string;
    authorization: AttackAuthorizationRecord;
    runId: string;
  }
): Promise<void> {
  const { after } = await import("next/server");
  after(async () => {
    try {
      await recordBrowserSimulationMemory(admin, {
        organizationId: input.request.context.organizationId,
        projectId: input.request.context.projectId,
        type: "browser_simulation_started",
        payload: { runId: input.runId, targetUrl: input.targetUrl },
        idempotencyKey: `browser_started:${input.runId}`,
      });

      const store = createSupabaseRedTeamRunStore(admin);
      const { director } = createBrowserEnabledRedTeamEngine();
      await executeQueuedRedTeamRun(director, store, input.runId, {
        request: input.request,
        targetUrl: input.targetUrl,
        authorization: input.authorization,
      });

      await recordBrowserSimulationMemory(admin, {
        organizationId: input.request.context.organizationId,
        projectId: input.request.context.projectId,
        type: "browser_simulation_completed",
        payload: { runId: input.runId },
        idempotencyKey: `browser_completed:${input.runId}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordBrowserSimulationMemory(admin, {
        organizationId: input.request.context.organizationId,
        projectId: input.request.context.projectId,
        type: "browser_simulation_failed",
        payload: { runId: input.runId, error: message.slice(0, 200) },
        idempotencyKey: `browser_failed:${input.runId}`,
      });
    }
  });
}

export function buildRedTeamIdempotencyKey(input: {
  projectId: string;
  commitSha: string | null;
  targetOrigin: string;
  environmentType: string;
}): string {
  return `${input.projectId}:${input.commitSha ?? "none"}:${input.targetOrigin}:${input.environmentType}`;
}

export function newRedTeamRunId(): string {
  return randomUUID();
}
