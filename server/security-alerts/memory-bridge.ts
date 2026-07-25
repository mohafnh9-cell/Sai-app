import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertCandidate } from "./types";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "security-alerts", event, ...fields });
}

function missingTable(message: string): boolean {
  return message.includes("does not exist");
}

export async function appendAlertSentMemory(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    alertId: string;
    alertKind: string;
    dedupeKey: string;
    severity: string;
  }
): Promise<void> {
  const { error } = await admin.from("protection_events").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    type: "alert_sent",
    idempotency_key: `alert:${input.dedupeKey}`,
    payload: {
      channel: "in_app",
      alertKind: input.alertKind,
      dedupeKey: input.dedupeKey,
      alertId: input.alertId,
      severity: input.severity,
    },
  });
  if (error) {
    if (error.code === "23505") return;
    if (missingTable(error.message)) return;
    log("alert_sent_memory_failed", { error: error.message });
  }
}

export function buildAlertCopy(
  projectName: string,
  candidate: AlertCandidate
): { titlePlain: string; bodyPlain: string } {
  const changed =
    candidate.changedBullets.length > 0
      ? candidate.changedBullets.map((b) => `• ${b}`).join("\n")
      : "• Something material changed during today's protection check.";

  const bodyPlain = [
    candidate.worryLine,
    "",
    "What changed:",
    changed,
    "",
    "What to do next:",
    candidate.nextAction,
  ].join("\n");

  const titlePlain =
    candidate.severity === "critical"
      ? `Something important changed in ${projectName}`
      : `SequrAI is watching — ${projectName} needs a look`;

  return { titlePlain, bodyPlain };
}
