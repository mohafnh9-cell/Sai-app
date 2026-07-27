import { isFeatureEnabled } from "@/server/feature-flags";

export type LlmTeamOperatingMode = "disabled" | "analysis_only" | "full";

function readModeOverride(): LlmTeamOperatingMode | null {
  const raw = process.env.SEQURAI_LLM_TEAM_MODE?.trim().toLowerCase();
  if (!raw || raw === "full" || raw === "enabled") return "full";
  if (raw === "disabled") return "disabled";
  if (raw === "analysis_only" || raw === "analysis-only") return "analysis_only";
  if (raw === "private_beta" || raw === "private-beta") return "full";
  if (raw === "partial") return "full";
  return null;
}

export function getLlmTeamOperatingMode(context?: { organizationId?: string }): LlmTeamOperatingMode {
  const override = readModeOverride();
  if (override === "disabled") return "disabled";
  if (override === "analysis_only") return "analysis_only";
  if (!isFeatureEnabled("llm_team", context)) return "disabled";
  if (override === "full") return "full";
  return "full";
}

export function isLlmTeamEnabled(context?: { organizationId?: string }): boolean {
  return getLlmTeamOperatingMode(context) !== "disabled";
}

export function isLlmTeamAnalysisOnly(context?: { organizationId?: string }): boolean {
  return getLlmTeamOperatingMode(context) === "analysis_only";
}
