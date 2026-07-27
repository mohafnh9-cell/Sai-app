import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { appendProtectionEvent } from "@/server/production-memory/append-event";
import type { SecurityDecisionReport } from "./decision-model";

export async function recordSecurityDecisionMemory(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    report: SecurityDecisionReport;
    kind: "decision_created" | "decision_changed" | "deployment_approved" | "deployment_blocked" | "policy_triggered" | "coverage_gap";
  }
): Promise<void> {
  const typeMap = {
    decision_created: "security_decision_created",
    decision_changed: "security_decision_changed",
    deployment_approved: "security_deployment_approved",
    deployment_blocked: "security_deployment_blocked",
    policy_triggered: "security_policy_triggered",
    coverage_gap: "security_coverage_gap",
  } as const;

  await appendProtectionEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: typeMap[input.kind],
    payload: {
      decisionId: input.report.decision.decisionId,
      deploymentVerdict: input.report.decision.deploymentVerdict,
      decision: input.report.decision.decision,
      policies: input.report.decision.policiesTriggered,
      coverageScore: input.report.coverageScore,
      gaps: input.report.coverageGaps,
    },
    idempotencyKey: `${typeMap[input.kind]}:${input.report.decision.decisionId}`,
  });
}
