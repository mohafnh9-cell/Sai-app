"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttackCenterSnapshot } from "./types";
import type { AttackCenterCapability } from "./api-types";
import { resolveViewState } from "./view-state";
import { useAttackCenterLive } from "./hooks/useAttackCenterLive";
import { AttackCampaignView } from "./components/AttackCampaignView";
import { AttackExecutionViewPanel } from "./components/AttackExecutionViewPanel";
import { AttackFindingViewPanel } from "./components/AttackFindingViewPanel";
import { SecurityTestPanel } from "@/features/security-testing/components/SecurityTestPanel";
import type { SecurityTestContext } from "@/features/security-testing/types";
import { SecurityTestProgressSteps } from "@/features/security-testing/components/SecurityTestProgressSteps";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import {
  buildLiveProgressSteps,
  deriveLiveTestPhase,
} from "@/features/security-testing/lib/live-test-copy";
import { EMPTY_STATE_COPY } from "@/features/security-testing/lib/product-copy";
import { PrimaryActionButton, SecurityTestHero } from "@/features/security-testing/components/SecurityTestHero";

export function AttackCenterExperience({
  projectId,
  initialSnapshot,
  initialCampaignId,
  initialCapability = null,
  reviewContext,
  securityTestContext = null,
}: {
  projectId: string;
  initialSnapshot: AttackCenterSnapshot | null;
  initialCampaignId?: string | null;
  initialCapability?: AttackCenterCapability | null;
  reviewContext?: ProjectReviewUiContext | null;
  securityTestContext?: SecurityTestContext | null;
}) {
  const router = useRouter();
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

  const liveProgressSteps = useMemo(() => {
    if (viewState.kind === "content" && viewState.snapshot.kind === "campaign") {
      return buildLiveProgressSteps(deriveLiveTestPhase(viewState.snapshot));
    }
    if (findingId) {
      return buildLiveProgressSteps("fix_ready");
    }
    return securityTestContext?.progressSteps ?? null;
  }, [viewState, findingId, securityTestContext?.progressSteps]);

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
        setActionError(body?.error ?? "Verification could not finish.");
        return;
      }
      if (body.snapshot) setSnapshot(body.snapshot);
    } finally {
      setVerifying(false);
    }
  }, [findingId, projectId, setSnapshot]);

  const findingIsVerified =
    viewState.kind === "content" &&
    viewState.snapshot.kind === "finding" &&
    Boolean(viewState.snapshot.protection);

  return (
    <div className="space-y-6 max-w-2xl">
      {liveProgressSteps ? <SecurityTestProgressSteps steps={liveProgressSteps} /> : null}

      {viewState.kind === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : null}

      {viewState.kind === "disabled" ? (
        <SecurityTestHero
          headline="Security testing is not available"
          description="Ask your admin to turn this on for your project."
          progressSteps={liveProgressSteps ?? []}
          primaryAction={<PrimaryActionButton disabled>Not available</PrimaryActionButton>}
        />
      ) : null}

      {viewState.kind === "error" ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-3">
          <p className="text-sm font-medium">Something went wrong.</p>
          <p className="text-sm text-muted-foreground">{viewState.error.message}</p>
          <div className="flex flex-wrap gap-2">
            {!viewState.error.fatal ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
                Try again
              </Button>
            ) : null}
            {viewState.error.details ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowErrorDetails((value) => !value)}
              >
                {showErrorDetails ? "Hide details" : "Technical details"}
              </Button>
            ) : null}
          </div>
          {showErrorDetails && viewState.error.details ? (
            <p className="text-xs text-muted-foreground font-mono">{viewState.error.details}</p>
          ) : null}
        </div>
      ) : null}

      {viewState.kind === "empty" ? (
        securityTestContext && reviewContext ? (
          <SecurityTestPanel
            projectId={projectId}
            context={securityTestContext}
            reviewContext={reviewContext}
            compact
          />
        ) : (
          <SecurityTestHero
            headline={EMPTY_STATE_COPY.headline}
            description={EMPTY_STATE_COPY.description}
            progressSteps={liveProgressSteps ?? []}
            showEstimatedDuration
            showSafetyNote
            primaryAction={
              <PrimaryActionButton onClick={() => router.push(`/projects/${projectId}/mission-control`)}>
                {EMPTY_STATE_COPY.primaryActionLabel}
              </PrimaryActionButton>
            }
          />
        )
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
              Deploy with confidence
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
          ← Back
        </button>
      ) : null}
    </div>
  );
}
