import type { MissionTeamId, MissionTeamStatus } from "../types";

const MISSION_TEAM_IDS: MissionTeamId[] = [
  "browser",
  "authentication",
  "api",
  "authorization",
  "business_logic",
  "llm",
  "adversarial",
];

const MISSION_STATUSES: MissionTeamStatus[] = [
  "running",
  "queued",
  "completed",
  "skipped",
  "failed",
];

function isMissionTeamStatus(value: string): value is MissionTeamStatus {
  return MISSION_STATUSES.includes(value as MissionTeamStatus);
}

function isMissionTeamId(value: string): value is MissionTeamId {
  return MISSION_TEAM_IDS.includes(value as MissionTeamId);
}

/** Reads `redTeamTeamExecution` or `teamExecution` from scan / session metadata. */
export function parseMissionTeamExecutionFromMetadata(
  meta: Record<string, unknown> | null | undefined
): Partial<Record<MissionTeamId, MissionTeamStatus>> | undefined {
  if (!meta) return undefined;
  const raw = meta.redTeamTeamExecution ?? meta.teamExecution;
  if (!raw || typeof raw !== "object") return undefined;

  const out: Partial<Record<MissionTeamId, MissionTeamStatus>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (!isMissionTeamId(key) || !isMissionTeamStatus(value)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
