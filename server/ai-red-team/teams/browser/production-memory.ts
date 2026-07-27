import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { appendProtectionEvent } from "@/server/production-memory/append-event";

export async function recordBrowserSimulationMemory(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    type:
      | "browser_simulation_requested"
      | "browser_simulation_started"
      | "browser_simulation_completed"
      | "browser_simulation_partial"
      | "browser_simulation_failed";
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  }
): Promise<void> {
  await appendProtectionEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: input.type,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
  });
}
