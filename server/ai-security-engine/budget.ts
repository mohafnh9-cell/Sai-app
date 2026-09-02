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
 * Counts real ai_reports rows for the organization since midnight UTC
 * (call count + summed tokens_used), the same "count real event rows"
 * pattern scan-rate-limit.ts already uses elsewhere in this codebase.
 */
export async function assertAiBudgetAvailable(
  admin: SupabaseClient,
  organizationId: string
): Promise<void> {
  const callsLimit = aiCallsPerOrganizationPerDayLimit();
  const tokenLimit = aiTokenBudgetPerOrganizationPerDayLimit();
  if (callsLimit == null && tokenLimit == null) return;

  const { data, error } = await admin
    .from("ai_reports")
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
      message: error.message,
    });
    return;
  }

  const rows = data ?? [];
  const callsUsed = rows.length;
  const tokensUsed = rows.reduce((sum, row) => sum + (Number(row.tokens_used) || 0), 0);

  if (callsLimit != null && callsUsed >= callsLimit) {
    throw new AiBudgetExceededError("calls", callsLimit, callsUsed);
  }
  if (tokenLimit != null && tokensUsed >= tokenLimit) {
    throw new AiBudgetExceededError("tokens", tokenLimit, tokensUsed);
  }
}
