import type { AttackCenterSnapshot } from "./types";

export type AttackCenterCapability = {
  enabled: boolean;
  reason?: "beta_not_enabled" | "internal_only";
  rollout?: string;
  runtimeModes: readonly string[];
};

export type AttackCenterListApiResponse = {
  ok: boolean;
  campaigns?: Array<{
    id: string;
    status: string;
    commitSha: string;
    progressPercent: number;
    updatedAt: string;
  }>;
  activeCampaign?: AttackCenterSnapshot | null;
  snapshot?: AttackCenterSnapshot | null;
  capability?: AttackCenterCapability;
  error?: string;
  code?: string;
  details?: string | null;
};

export type AttackCenterRefreshError = {
  message: string;
  code?: string;
  status: number;
  fatal: boolean;
  details?: string | null;
};
