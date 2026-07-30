export type {
  AttackCenterSnapshot,
  AttackCenterCampaignView,
  AttackCenterExecutionView,
  AttackCenterFindingView,
  AttackCenterFeedItem,
} from "@/server/attack-simulation/ui/types";

export type AttackCenterViewMode = "campaign" | "execution" | "finding";

export type AttackCenterRouteState = {
  campaignId?: string;
  executionId?: string;
  findingId?: string;
};
