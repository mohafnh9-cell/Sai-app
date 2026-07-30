import "server-only";

import type { AttackCenterSnapshot } from "../ui/types";
import type { AttackCampaign } from "../contracts/attack-campaign";
import { getFeatureRollout, isFeatureEnabled } from "@/server/feature-flags";
import { ATTACK_RUNTIME_MODES } from "../contracts/enums";

export type AttackCenterCapability = {
  enabled: boolean;
  reason?: "beta_not_enabled" | "internal_only";
  rollout?: string;
  runtimeModes: readonly string[];
};

export type AttackCenterListResponse = {
  ok: true;
  campaigns: Array<{
    id: string;
    status: string;
    commitSha: string;
    progressPercent: number;
    updatedAt: string;
  }>;
  activeCampaign: AttackCenterSnapshot | null;
  snapshot: AttackCenterSnapshot | null;
  capability: AttackCenterCapability;
};

export function buildAttackCenterCapability(input: {
  organizationId: string;
}): AttackCenterCapability {
  const enabled = isFeatureEnabled("attack_simulation", {
    organizationId: input.organizationId,
  });
  const rollout = getFeatureRollout("attack_simulation");

  if (!enabled) {
    return {
      enabled: false,
      reason: rollout === "internal" ? "internal_only" : "beta_not_enabled",
      rollout,
      runtimeModes: [],
    };
  }

  return {
    enabled: true,
    rollout,
    runtimeModes: ATTACK_RUNTIME_MODES.filter((mode) =>
      ["static", "mock", "sandbox", "authorized_staging"].includes(mode)
    ),
  };
}

export function buildAttackCenterListResponse(input: {
  organizationId: string;
  campaigns: AttackCampaign[];
  activeCampaign: AttackCenterSnapshot | null;
}): AttackCenterListResponse {
  const capability = buildAttackCenterCapability({ organizationId: input.organizationId });

  return {
    ok: true,
    campaigns: input.campaigns.map((campaign) => ({
      id: campaign.id,
      status: campaign.status,
      commitSha: campaign.commitSha,
      progressPercent: campaign.progressPercent,
      updatedAt: campaign.updatedAt,
    })),
    activeCampaign: input.activeCampaign,
    snapshot: input.activeCampaign,
    capability,
  };
}

export function buildAttackCenterDisabledResponse(input: {
  organizationId: string;
}): AttackCenterListResponse {
  const capability = buildAttackCenterCapability({ organizationId: input.organizationId });
  return {
    ok: true,
    campaigns: [],
    activeCampaign: null,
    snapshot: null,
    capability,
  };
}
