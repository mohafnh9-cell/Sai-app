import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSafeFixById } from "./history";
import type { SafeFixRecord, SafeFixScope } from "./types";

type McpSafeFixResult = {
  status?: string;
  project?: { id?: string; name?: string };
  summary?: string;
  blocker?: { id: string; title: string; severity: string; category: string };
  safeFixPrompt?: string;
  priorityId?: string;
};

export async function enrichMcpSafeFixWithV2(
  admin: SupabaseClient,
  organizationId: string,
  mcpResult: McpSafeFixResult
): Promise<
  McpSafeFixResult & {
    safeFixV2?: SafeFixRecord;
    engineerSummary?: string;
    /** created: a new proposal; reused: the existing proposal for this analysis (idempotent); in_flight: refused, see note. */
    safeFixStatus?: "created" | "reused" | "in_flight";
    safeFixNote?: string;
  }
> {
  if (mcpResult.status !== "prompt_ready" || !mcpResult.project?.id) {
    return mcpResult;
  }

  const { generateSafeFix } = await import("./generate");
  try {
    const generated = await generateSafeFix(admin, {
      organizationId,
      projectId: mcpResult.project.id,
      projectName: mcpResult.project.name ?? "Project",
      priorityId: mcpResult.blocker?.id,
      blockerId: mcpResult.blocker?.id,
      actor: "mcp",
    });

    if (generated.status === "in_flight") {
      // A correction for this blocker is already approved / applied / being verified on a different analysis. Nothing
      // was created or changed; say so explicitly instead of handing out a second, competing proposal.
      return {
        ...mcpResult,
        safeFixV2: generated.record,
        safeFixStatus: "in_flight",
        safeFixNote: `A Safe Fix for this blocker is already in progress (state ${generated.record.lifecycleState}, id ${generated.record.id}) and was built on a previous analysis. It was kept unchanged; no new proposal was created. Finish or reopen that one first.`,
      };
    }
    if (generated.status !== "ready") return mcpResult;

    const doc = generated.record.document;
    const engineerSummary = [
      doc.explanationNarrative,
      "",
      `Safe Fix confidence: ${generated.record.confidenceBand}`,
      "",
      doc.executiveSummary,
      "",
      "Verification checklist:",
      ...doc.verificationChecklist.slice(0, 4).map((c) => `• ${c}`),
    ].join("\n");

    return {
      ...mcpResult,
      summary: `${engineerSummary}\n\n---\n\n${mcpResult.summary ?? ""}`.trim(),
      safeFixV2: generated.record,
      safeFixStatus: generated.reused ? "reused" : "created",
      ...(generated.reused
        ? { safeFixNote: `This blocker already has a Safe Fix for the same analysis (state ${generated.record.lifecycleState}, id ${generated.record.id}); it was reused, not duplicated.` }
        : {}),
      engineerSummary,
    };
  } catch (error) {
    console.error({
      component: "safe-fix-mcp-enrichment",
      event: "v2_persist_failed",
      projectId: mcpResult.project.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return mcpResult;
  }
}

export async function loadSafeFixForMcpSummary(
  admin: SupabaseClient,
  safeFixId: string,
  scope: SafeFixScope
): Promise<SafeFixRecord | null> {
  return getSafeFixById(admin, safeFixId, scope);
}
