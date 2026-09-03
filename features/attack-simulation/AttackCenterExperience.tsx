"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AttackSimulationLoadingPanel } from "./components/AttackSimulationLoadingPanel";
import { DynamicTargetAuthorizationPanel } from "./components/DynamicTargetAuthorizationPanel";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import type { AttackCenterSnapshot } from "./types";
import type { AttackCenterCapability } from "./api-types";
import { resolveViewState } from "./view-state";
import { useAttackCenterLive } from "./hooks/useAttackCenterLive";
import { AttackCampaignView } from "./components/AttackCampaignView";
import { AttackExecutionViewPanel } from "./components/AttackExecutionViewPanel";
import { AttackFindingViewPanel } from "./components/AttackFindingViewPanel";
import { emptyStateCopy } from "@/features/security-testing/lib/product-copy";
import { PrimaryActionButton, SecurityTestHero } from "@/features/security-testing/components/SecurityTestHero";
import type { DynamicTargetAuthorizationStatus } from "@/server/ai-red-team/authorization/dynamic-target-authorization-types";
import { deriveAttackCampaignUiMode } from "./lib/campaign-ui-mode";

export function AttackCenterExperience({
  projectId,
  initialSnapshot,
  initialCampaignId,
  initialCapability = null,
  analysisRunId = null,
  dynamicTargetAuthorizationStatus = null,
  skipTargetVerification = false,
}: {
  projectId: string;
  initialSnapshot: AttackCenterSnapshot | null;
  initialCampaignId?: string | null;
  initialCapability?: AttackCenterCapability | null;
  analysisRunId?: string | null;
  dynamicTargetAuthorizationStatus?: DynamicTargetAuthorizationStatus | null;
  skipTargetVerification?: boolean;
}) {
  const router = useRouter();
  const { t: ts } = useI18n("securityTest");
  const { t: ta } = useI18n("attackCenter");
  const [findingId, setFindingId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const campaignId = useMemo(() => {
    if (initialCampaignId) return initialCampaignId;
    if (initialSnapshot?.kind === "campaign") return initialSnapshot.campaign.id;
    if (initialSnapshot?.kind === "execution") return initialSnapshot.execution.campaignId;
    return null;
  }, [initialCampaignId, initialSnapshot]);

  const { snapshot, capability, loading, error, refresh, setSnapshot } = useAttackCenterLive({
    projectId,
    analysisRunId,
    campaignId: findingId ? null : campaignId,
    executionId: null,
    findingId,
    initialSnapshot,
    initialCapability,
  });

  const viewState = resolveViewState({
    loading,
    capability,
    error,
    snapshot,
  });

  const emptyCopy = emptyStateCopy(ts);
  const campaignUiMode = useMemo(
    () => deriveAttackCampaignUiMode(snapshot),
    [snapshot]
  );

  const handleOpenFinding = useCallback((nextFindingId: string) => {
    setFindingId(nextFindingId);
    setActionError(null);
  }, []);

  const handleBackToOverview = useCallback(() => {
    setFindingId(null);
    setActionError(null);
    void refresh();
  }, [refresh]);

  const handleVerifyProtection = useCallback(async () => {
    if (!findingId) return;
    setVerifying(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/attack-findings/${findingId}/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipIfVerified: false }),
      });
      const body = (await response.json().catch(() => null)) as {
        snapshot?: AttackCenterSnapshot;
        error?: string;
      };
      if (!response.ok) {
        setActionError(body?.error ?? ts("errors.verifyFailed"));
        return;
      }
      if (body.snapshot) setSnapshot(body.snapshot);
    } finally {
      setVerifying(false);
    }
  }, [findingId, projectId, setSnapshot, ts]);

  const findingIsVerified =
    viewState.kind === "content" &&
    viewState.snapshot.kind === "finding" &&
    Boolean(viewState.snapshot.protection);

  return (
    <div className="space-y-8">
      {dynamicTargetAuthorizationStatus ? (
        <DynamicTargetAuthorizationPanel
          projectId={projectId}
          initialStatus={dynamicTargetAuthorizationStatus}
          skipTargetVerification={skipTargetVerification}
          campaignUiMode={campaignUiMode}
        />
      ) : null}

      <div className="space-y-6 max-w-4xl">
      {viewState.kind === "loading" ? (
        <AttackSimulationLoadingPanel />
      ) : null}

      {viewState.kind === "disabled" ? (
        <SecurityTestHero
          headline={ta("disabled.headline")}
          description={ta("disabled.description")}
          progressSteps={[]}
          primaryAction={<PrimaryActionButton disabled>{ta("disabled.action")}</PrimaryActionButton>}
        />
      ) : null}

      {viewState.kind === "error" ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-3">
          <p className="text-sm font-medium">{ta("error.headline")}</p>
          <p className="text-sm text-muted-foreground">{viewState.error.message}</p>
          <div className="flex flex-wrap gap-2">
            {!viewState.error.fatal ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
                {ta("error.tryAgain")}
              </Button>
            ) : null}
            {viewState.error.details ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowErrorDetails((value) => !value)}
              >
                {showErrorDetails ? ta("error.hideDetails") : ta("error.showDetails")}
              </Button>
            ) : null}
          </div>
          {showErrorDetails && viewState.error.details ? (
            <p className="text-xs text-muted-foreground font-mono">{viewState.error.details}</p>
          ) : null}
        </div>
      ) : null}

      {viewState.kind === "empty" ? (
        <SecurityTestHero
          headline={emptyCopy.headline}
          description={emptyCopy.description}
          progressSteps={[]}
          showEstimatedDuration
          showSafetyNote
          primaryAction={
            <PrimaryActionButton onClick={() => router.push(`/projects/${projectId}/mission-control`)}>
              {emptyCopy.primaryActionLabel}
            </PrimaryActionButton>
          }
        />
      ) : null}

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

      {viewState.kind === "content" && viewState.snapshot.kind === "campaign" ? (
        <AttackCampaignView view={viewState.snapshot} onOpenFinding={handleOpenFinding} />
      ) : null}

      {viewState.kind === "content" && viewState.snapshot.kind === "execution" ? (
        <AttackExecutionViewPanel view={viewState.snapshot} />
      ) : null}

      {viewState.kind === "content" && viewState.snapshot.kind === "finding" ? (
        <>
          <AttackFindingViewPanel
            view={viewState.snapshot}
            onVerifyProtection={() => void handleVerifyProtection()}
            verifying={verifying}
            onBack={findingIsVerified ? undefined : handleBackToOverview}
          />
          {findingIsVerified ? (
            <PrimaryActionButton onClick={() => router.push(`/projects/${projectId}/mission-control`)}>
              {ta("deployWithConfidence")}
            </PrimaryActionButton>
          ) : null}
        </>
      ) : null}

      {findingId && viewState.kind === "content" && viewState.snapshot.kind !== "finding" ? (
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={handleBackToOverview}
        >
          {ta("back")}
        </button>
      ) : null}
      </div>
    </div>
  );
}
