import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSafeFixById } from "./history";
import type { SafeFixRecord } from "./types";

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
): Promise<McpSafeFixResult & { safeFixV2?: SafeFixRecord; engineerSummary?: string }> {
  if (mcpResult.status !== "prompt_ready" || !mcpResult.project?.id) {
    return mcpResult;
  }

  const { generateSafeFix } = await import("./generate");
  const generated = await generateSafeFix(admin, {
    organizationId,
    projectId: mcpResult.project.id,
    projectName: mcpResult.project.name ?? "Project",
    priorityId: mcpResult.blocker?.id,
    blockerId: mcpResult.blocker?.id,
    actor: "mcp",
  });

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
    engineerSummary,
  };
}

export async function loadSafeFixForMcpSummary(
  admin: SupabaseClient,
  safeFixId: string
): Promise<SafeFixRecord | null> {
  return getSafeFixById(admin, safeFixId);
}
