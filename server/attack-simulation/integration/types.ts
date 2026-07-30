import { z } from "zod";

export const attackSimulationVerdictOverlaySchema = z.object({
  campaignId: z.string().uuid().nullable(),
  campaignStatus: z.string(),
  totalExecutions: z.number().int().min(0),
  confirmedFindings: z.number().int().min(0),
  notExploitableFindings: z.number().int().min(0),
  protectedExecutions: z.number().int().min(0),
  stillVulnerableExecutions: z.number().int().min(0),
  blockedExecutions: z.number().int().min(0),
  pendingReplay: z.number().int().min(0),
  headline: z.string(),
});

export type AttackSimulationVerdictOverlay = z.infer<typeof attackSimulationVerdictOverlaySchema>;

export type ScanAttackSimulationPhaseResult =
  | {
      ok: true;
      skipped: true;
      reason: "feature_disabled" | "no_hypotheses" | "existing_campaign";
      campaignId?: string;
    }
  | {
      ok: true;
      skipped: false;
      campaignId: string;
      executionIds: string[];
      hypothesisCount: number;
    }
  | {
      ok: false;
      failureCode: string;
      safeFailureMessage: string;
    };
