import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SECURITY_TEST_IDS } from "@/features/security-testing/user-test-catalog";
import { isFeatureEnabled } from "@/server/feature-flags";
import { getSecurityTestContext } from "@/server/attack-simulation/get-security-test-context";
import { mapSelectedTestsToHypotheses } from "@/server/attack-simulation/security-test-options";
import { startAttackCampaign } from "@/server/attack-simulation/start-attack-campaign";
import { getAttackCampaignByScanId, getAttackCampaignById, listAttackScenariosForCampaign } from "@/server/attack-simulation/persistence/campaign-repository";
import { listAttackExecutionsForCampaign } from "@/server/attack-simulation/persistence/execution-repository";
import { getTranslator } from "@/lib/i18n/server";
import { pollUntilAttackCampaignTerminal, waitForScanCampaign } from "./poll";
import { selectAttacksFromFindings } from "./select-attacks-from-findings";
import type { StaticFindingInput } from "./correlate-findings";

export type SecurityTestRunResult = {
  campaignId: string | null;
  executionIds: string[];
  adaptersExecuted: string[];
  adaptersSelectedFromFindings: string[];
  runtimeMode: string | null;
  skippedReason: string | null;
  timedOut: boolean;
};

export async function ensureSecurityTestsForAudit(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    scanJobId: string | null;
    commitSha: string;
    waitForScanBootstrapMs?: number;
    staticFindings?: StaticFindingInput[];
  }
): Promise<SecurityTestRunResult> {
  if (!isFeatureEnabled("attack_simulation", { organizationId: input.organizationId })) {
    return {
      campaignId: null,
      executionIds: [],
      adaptersExecuted: [],
      adaptersSelectedFromFindings: [],
      runtimeMode: null,
      skippedReason: "feature_disabled",
      timedOut: false,
    };
  }

  const selectedAdapterIds = selectAttacksFromFindings({
    staticFindings: input.staticFindings ?? [],
    fallbackAdapterIds: DEFAULT_SECURITY_TEST_IDS,
  });

  const bootstrapWait = await waitForScanCampaign(
    admin,
    { scanId: input.scanId, organizationId: input.organizationId },
    { maxMs: input.waitForScanBootstrapMs ?? 120_000 }
  );

  let campaignId = bootstrapWait.campaignId;
  let timedOut = bootstrapWait.timedOut;

  if (!campaignId) {
    const { t } = await getTranslator("securityTest");
    const context = await getSecurityTestContext(admin, {
      projectId: input.projectId,
      organizationId: input.organizationId,
    });

    const testIds = selectedAdapterIds;
    const hypotheses = mapSelectedTestsToHypotheses(testIds, context.hypotheses, t);

    if (hypotheses.length === 0) {
      return {
        campaignId: null,
        executionIds: [],
        adaptersExecuted: [],
        adaptersSelectedFromFindings: selectedAdapterIds,
        runtimeMode: null,
        skippedReason: "no_plannable_tests",
        timedOut: false,
      };
    }

    const started = await startAttackCampaign(admin, {
      projectId: input.projectId,
      organizationId: input.organizationId,
      body: {
        scanId: input.scanId,
        scanJobId: input.scanJobId,
        commitSha: input.commitSha,
        runtimeMode: "mock",
        hypotheses,
      },
    });

    campaignId = started.campaignId;
    const poll = await pollUntilAttackCampaignTerminal(admin, {
      campaignId,
      organizationId: input.organizationId,
    });
    timedOut = poll.timedOut;

    return buildSecurityTestSummary(admin, {
      campaignId,
      organizationId: input.organizationId,
      executionIds: started.executionIds,
      adaptersSelectedFromFindings: selectedAdapterIds,
      skippedReason: null,
      timedOut,
    });
  }

  const existing = await getAttackCampaignByScanId(admin, input.scanId, input.organizationId);
  if (existing && campaignId) {
    const poll = await pollUntilAttackCampaignTerminal(admin, {
      campaignId,
      organizationId: input.organizationId,
    });
    timedOut = timedOut || poll.timedOut;
    const executions = await listAttackExecutionsForCampaign(
      admin,
      campaignId,
      input.organizationId
    );
    return buildSecurityTestSummary(admin, {
      campaignId,
      organizationId: input.organizationId,
      executionIds: executions.map((execution) => execution.id),
      adaptersSelectedFromFindings: selectedAdapterIds,
      skippedReason: null,
      timedOut,
    });
  }

  return {
    campaignId,
    executionIds: [],
    adaptersExecuted: [],
    adaptersSelectedFromFindings: selectedAdapterIds,
    runtimeMode: null,
    skippedReason: "campaign_unavailable",
    timedOut,
  };
}

async function buildSecurityTestSummary(
  admin: SupabaseClient,
  input: {
    campaignId: string;
    organizationId: string;
    executionIds: string[];
    adaptersSelectedFromFindings: string[];
    skippedReason: string | null;
    timedOut: boolean;
  }
): Promise<SecurityTestRunResult> {
  const campaign = await getAttackCampaignById(admin, input.campaignId, input.organizationId);
  const scenarios = await listAttackScenariosForCampaign(
    admin,
    input.campaignId,
    input.organizationId
  ).catch(() => []);

  const adaptersExecuted = [
    ...new Set(
      scenarios
        .map((scenario) => scenario.adapterId)
        .filter((adapterId): adapterId is string => Boolean(adapterId))
    ),
  ];

  return {
    campaignId: input.campaignId,
    executionIds: input.executionIds,
    adaptersExecuted,
    adaptersSelectedFromFindings: input.adaptersSelectedFromFindings,
    runtimeMode: campaign?.runtimeMode ?? null,
    skippedReason: input.skippedReason,
    timedOut: input.timedOut,
  };
}
