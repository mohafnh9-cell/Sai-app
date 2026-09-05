import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aiCallsPerOrganizationPerDayLimit,
  aiTokenBudgetPerOrganizationPerDayLimit,
} from "@/lib/env/ai-cost-control";

export class AiBudgetExceededError extends Error {
  constructor(
    public readonly reason: "calls" | "tokens",
    public readonly limit: number,
    public readonly used: number
  ) {
    super(
      `AI budget exceeded for this organization today (${reason}: ${used}/${limit}). Try again tomorrow.`
    );
    this.name = "AiBudgetExceededError";
  }
}

function startOfTodayUtcIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * M2 (audit): call before analyzeScanWithClaude, not after -- rejecting a
 * request that's already over budget must not itself cost another call.
 * Counts real event rows for the organization since midnight UTC (call
 * count + summed tokens_used), the same "count real event rows" pattern
 * scan-rate-limit.ts already uses elsewhere in this codebase.
 *
 * Phase 30: `tables` defaults to `["ai_reports"]` (unchanged behavior for
 * existing callers). The selective AI reasoning overlay
 * (server/ai-reasoning/analyze.ts) passes `["ai_reports", "ai_finding_reasoning"]`
 * so both AI features share one real per-organization daily budget instead
 * of each getting its own -- there is deliberately no second budget system.
 */
export async function assertAiBudgetAvailable(
  admin: SupabaseClient,
  organizationId: string,
  tables: readonly string[] = ["ai_reports"]
): Promise<void> {
  const callsLimit = aiCallsPerOrganizationPerDayLimit();
  const tokenLimit = aiTokenBudgetPerOrganizationPerDayLimit();
  if (callsLimit == null && tokenLimit == null) return;

  let callsUsed = 0;
  let tokensUsed = 0;

  for (const table of tables) {
    const { data, error } = await admin
      .from(table)
      .select("tokens_used")
      .eq("organization_id", organizationId)
      .gte("created_at", startOfTodayUtcIso());

    if (error) {
      // Fail open on a query error (e.g. table temporarily unavailable) --
      // an outage in the budget check itself should not take down every
      // scan's AI analysis. The underlying request still goes through
      // whatever downstream limits already apply.
      console.warn({
        component: "ai-budget",
        event: "budget_check_failed_open",
        organizationId,
        table,
        message: error.message,
      });
      continue;
    }

    const rows = data ?? [];
    callsUsed += rows.length;
    tokensUsed += rows.reduce((sum, row) => sum + (Number(row.tokens_used) || 0), 0);
  }

  if (callsLimit != null && callsUsed >= callsLimit) {
    throw new AiBudgetExceededError("calls", callsLimit, callsUsed);
  }
  if (tokenLimit != null && tokensUsed >= tokenLimit) {
    throw new AiBudgetExceededError("tokens", tokenLimit, tokensUsed);
  }
}
