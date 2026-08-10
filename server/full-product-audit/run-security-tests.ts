import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SECURITY_TEST_IDS } from "@/features/security-testing/user-test-catalog";
import { isFeatureEnabled } from "@/server/feature-flags";
import { startAttackCampaign, StartAttackCampaignError } from "@/server/attack-simulation/start-attack-campaign";
import { getAttackCampaignByScanId, getAttackCampaignById, listAttackScenariosForCampaign } from "@/server/attack-simulation/persistence/campaign-repository";
import { listAttackExecutionsForCampaign } from "@/server/attack-simulation/persistence/execution-repository";
import { getTranslator } from "@/lib/i18n/server";
import { pollUntilAttackCampaignTerminal, waitForScanCampaign } from "./poll";
import { selectAttacksFromFindings } from "./select-attacks-from-findings";
import { resolveDynamicTargetForAudit } from "./resolve-dynamic-target";
import { buildHypothesesFromStaticFindings } from "./build-hypotheses-from-findings";
import { collectRequiredDynamicPaths } from "./required-dynamic-paths";
import {
  pathsMissingFromApprovedScope,
  reapproveExpandedDynamicTargetScope,
} from "@/server/ai-red-team/authorization/dynamic-scope-expansion";
import {
  resolveDynamicVerificationExecution,
  type DynamicVerificationDecision,
  type DynamicVerificationState,
} from "./dynamic-verification-flow";
import type { StaticFindingInput } from "./correlate-findings";

export type SecurityTestRunResult = {
  campaignId: string | null;
  executionIds: string[];
  adaptersExecuted: string[];
  adaptersSelectedFromFindings: string[];
  runtimeMode: string | null;
  dynamicTargetSource: string | null;
  skippedReason: string | null;
  timedOut: boolean;
  dynamicVerification: DynamicVerificationState;
};

function emptyDynamicVerification(
  decision?: DynamicVerificationDecision
): DynamicVerificationState {
  return {
    offered: false,
    decision: decision ?? null,
    authorizedTarget: null,
    awaitingUrl: false,
    awaitingAuthorization: false,
    awaitingScopeApproval: false,
    notSafelyTestableCount: 0,
  };
}

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
    dynamicVerificationDecision?: DynamicVerificationDecision;
    dynamicScopeExpansionApproved?: boolean;
    createdBy?: string | null;
  }
): Promise<SecurityTestRunResult> {
  if (!isFeatureEnabled("attack_simulation", { organizationId: input.organizationId })) {
    return {
      campaignId: null,
      executionIds: [],
      adaptersExecuted: [],
      adaptersSelectedFromFindings: [],
      runtimeMode: null,
      dynamicTargetSource: null,
      skippedReason: "feature_disabled",
      timedOut: false,
      dynamicVerification: emptyDynamicVerification(input.dynamicVerificationDecision),
    };
  }

  const staticFindings = input.staticFindings ?? [];
  const selectedAdapterIds = selectAttacksFromFindings({
    staticFindings,
    fallbackAdapterIds: DEFAULT_SECURITY_TEST_IDS,
  });

  const dynamicTarget = await resolveDynamicTargetForAudit(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  });

  const verificationPlan = resolveDynamicVerificationExecution({
    decision: input.dynamicVerificationDecision,
    hasAuthorizedTarget: dynamicTarget.source === "authorization" || dynamicTarget.source === "sandbox_lab",
    staticFindingsCount: staticFindings.length,
    selectedAdapterCount: selectedAdapterIds.length,
    authorizedTarget: dynamicTarget.targetUrl,
  });

  if (!verificationPlan.runDynamic) {
    return {
      campaignId: null,
      executionIds: [],
      adaptersExecuted: [],
      adaptersSelectedFromFindings: selectedAdapterIds,
      runtimeMode: dynamicTarget.runtimeMode,
      dynamicTargetSource: dynamicTarget.source,
      skippedReason: verificationPlan.skippedReason,
      timedOut: false,
      dynamicVerification: verificationPlan.state,
    };
  }

  const { t } = await getTranslator("securityTest");
  const requireMappedRoutes = dynamicTarget.source === "authorization";
  const built = buildHypothesesFromStaticFindings({
    staticFindings,
    selectedAdapterIds,
    requireMappedRoutes,
    t,
  });
  const hypotheses = built.hypotheses;

  if (hypotheses.length === 0) {
    return {
      campaignId: null,
      executionIds: [],
      adaptersExecuted: [],
      adaptersSelectedFromFindings: selectedAdapterIds,
      runtimeMode: dynamicTarget.runtimeMode,
      dynamicTargetSource: dynamicTarget.source,
      skippedReason: requireMappedRoutes ? "no_safely_testable_routes" : "no_plannable_tests",
      timedOut: false,
      dynamicVerification: {
        ...verificationPlan.state,
        notSafelyTestableCount: built.notSafelyTestableCount,
      },
    };
  }

  let activeAuthorization = dynamicTarget.authorization;
  if (dynamicTarget.source === "authorization" && activeAuthorization) {
    const requiredDynamicPaths = collectRequiredDynamicPaths(hypotheses);
    const allowedPaths = Array.isArray(activeAuthorization.approvedScope?.allowedPaths)
      ? (activeAuthorization.approvedScope.allowedPaths as string[])
      : [];
    const missingPaths = pathsMissingFromApprovedScope(
      requiredDynamicPaths,
      allowedPaths,
      activeAuthorization.pathExclusions
    );

    if (missingPaths.length > 0) {
      if (input.dynamicScopeExpansionApproved) {
        const expansion = await reapproveExpandedDynamicTargetScope(admin, {
          organizationId: input.organizationId,
          projectId: input.projectId,
          targetOrigin: activeAuthorization.targetOrigin,
          requiredPaths: missingPaths,
          createdBy: input.createdBy ?? null,
        });
        if (!expansion.ok) {
          return {
            campaignId: null,
            executionIds: [],
            adaptersExecuted: [],
            adaptersSelectedFromFindings: selectedAdapterIds,
            runtimeMode: dynamicTarget.runtimeMode,
            dynamicTargetSource: dynamicTarget.source,
            skippedReason: expansion.code,
            timedOut: false,
            dynamicVerification: {
              ...verificationPlan.state,
              notSafelyTestableCount: built.notSafelyTestableCount,
            },
          };
        }
        activeAuthorization = expansion.authorization;
      } else {
        return {
          campaignId: null,
          executionIds: [],
          adaptersExecuted: [],
          adaptersSelectedFromFindings: selectedAdapterIds,
          runtimeMode: dynamicTarget.runtimeMode,
          dynamicTargetSource: dynamicTarget.source,
          skippedReason: "awaiting_scope_approval",
          timedOut: false,
          dynamicVerification: {
            ...verificationPlan.state,
            awaitingScopeApproval: true,
            notSafelyTestableCount: built.notSafelyTestableCount,
          },
        };
      }
    }
  }

  const campaignPollMs = input.waitForScanBootstrapMs ?? 120_000;
  const bootstrapWait = await waitForScanCampaign(
    admin,
    { scanId: input.scanId, organizationId: input.organizationId },
    { maxMs: campaignPollMs }
  );

  let campaignId = bootstrapWait.campaignId;
  let timedOut = bootstrapWait.timedOut;

  if (!campaignId) {
    let started;
    try {
      started = await startAttackCampaign(admin, {
        projectId: input.projectId,
        organizationId: input.organizationId,
        body: {
          scanId: input.scanId,
          scanJobId: input.scanJobId,
          commitSha: input.commitSha,
          runtimeMode: dynamicTarget.runtimeMode,
          targetUrl: dynamicTarget.targetUrl,
          authorizationId: activeAuthorization?.id ?? dynamicTarget.authorization?.id ?? null,
          hypotheses,
        },
      });
    } catch (error) {
      if (error instanceof StartAttackCampaignError) {
        return {
          campaignId: null,
          executionIds: [],
          adaptersExecuted: [],
          adaptersSelectedFromFindings: selectedAdapterIds,
          runtimeMode: dynamicTarget.runtimeMode,
          dynamicTargetSource: dynamicTarget.source,
          skippedReason: error.code,
          timedOut: false,
          dynamicVerification: {
            ...verificationPlan.state,
            notSafelyTestableCount: built.notSafelyTestableCount,
          },
        };
      }
      throw error;
    }

    campaignId = started.campaignId;
    const poll = await pollUntilAttackCampaignTerminal(
      admin,
      {
        campaignId,
        organizationId: input.organizationId,
      },
      { maxMs: campaignPollMs }
    );
    timedOut = poll.timedOut;

    return buildSecurityTestSummary(admin, {
      campaignId,
      organizationId: input.organizationId,
      executionIds: started.executionIds,
      adaptersSelectedFromFindings: selectedAdapterIds,
      dynamicTargetSource: dynamicTarget.source,
      skippedReason: null,
      timedOut,
      dynamicVerification: {
        ...verificationPlan.state,
        notSafelyTestableCount: built.notSafelyTestableCount,
      },
    });
  }

  const existing = await getAttackCampaignByScanId(admin, input.scanId, input.organizationId);
  if (existing && campaignId) {
    const poll = await pollUntilAttackCampaignTerminal(
      admin,
      {
        campaignId,
        organizationId: input.organizationId,
      },
      { maxMs: campaignPollMs }
    );
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
      dynamicTargetSource: existing.runtimeMode === "mock" ? null : dynamicTarget.source,
      skippedReason: null,
      timedOut,
      dynamicVerification: verificationPlan.state,
    });
  }

  return {
    campaignId,
    executionIds: [],
    adaptersExecuted: [],
    adaptersSelectedFromFindings: selectedAdapterIds,
    runtimeMode: null,
    dynamicTargetSource: null,
    skippedReason: "campaign_unavailable",
    timedOut,
    dynamicVerification: verificationPlan.state,
  };
}

async function buildSecurityTestSummary(
  admin: SupabaseClient,
  input: {
    campaignId: string;
    organizationId: string;
    executionIds: string[];
    adaptersSelectedFromFindings: string[];
    dynamicTargetSource?: string | null;
    skippedReason: string | null;
    timedOut: boolean;
    dynamicVerification: DynamicVerificationState;
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
    dynamicTargetSource: input.dynamicTargetSource ?? null,
    skippedReason: input.skippedReason,
    timedOut: input.timedOut,
    dynamicVerification: input.dynamicVerification,
  };
}
