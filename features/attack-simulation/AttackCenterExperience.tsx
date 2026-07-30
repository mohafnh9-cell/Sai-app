"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttackCenterSnapshot } from "./types";
import type { AttackCenterCapability, AttackCenterRefreshError } from "./api-types";
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
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [findingId, setFindingId] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
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
    campaignId: findingId ? null : executionId ? null : campaignId,
    executionId: findingId ? null : executionId,
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
    if (findingId || executionId) {
      return buildLiveProgressSteps(findingId ? "fix_ready" : "running");
    }
    return securityTestContext?.progressSteps ?? null;
  }, [viewState, findingId, executionId, securityTestContext?.progressSteps]);

  const handleOpenFinding = useCallback((nextFindingId: string) => {
    setFindingId(nextFindingId);
    setExecutionId(null);
    setActionError(null);
  }, []);

  const handleBackToOverview = useCallback(() => {
    setFindingId(null);
    setExecutionId(null);
    setActionError(null);
    void refresh();
  }, [refresh]);

  const handleReplay = useCallback(async () => {
    if (!findingId) return;
    setReplaying(true);
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
        setActionError(body?.error ?? "Replay failed");
        return;
      }
      if (body.snapshot) setSnapshot(body.snapshot);
    } finally {
      setReplaying(false);
    }
  }, [findingId, projectId, setSnapshot]);

  const showSubView = Boolean(findingId || executionId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={`/projects/${projectId}/mission-control`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Mission Control
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">Security test</span>
      </div>

      {liveProgressSteps ? <SecurityTestProgressSteps steps={liveProgressSteps} /> : null}

      {showSubView && viewState.kind === "content" ? (
        <Button type="button" variant="outline" size="sm" onClick={handleBackToOverview}>
          ← Back to all tests
        </Button>
      ) : null}

      {viewState.kind === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your test…
        </div>
      ) : null}

      {viewState.kind === "disabled" ? (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-8 text-center text-sm">
          <p className="font-medium text-foreground">Security testing is not turned on for this project.</p>
          <p className="mt-2 text-muted-foreground">Ask your admin to enable it, then try again.</p>
        </div>
      ) : null}

      {viewState.kind === "error" ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-3">
          <p className="text-sm font-medium text-foreground">
            {viewState.error.fatal
              ? "We could not load your test right now."
              : "Something went wrong while refreshing."}
          </p>
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
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No tests yet. Go to Mission Control and tap &quot;Test my application&quot;.
          </div>
        )
      ) : null}

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

      {viewState.kind === "content" && viewState.snapshot.kind === "campaign" ? (
        <AttackCampaignView
          view={viewState.snapshot}
          onOpenFinding={handleOpenFinding}
          onSelectExecution={(id) => {
            setExecutionId(id);
            setFindingId(null);
          }}
        />
      ) : null}

      {viewState.kind === "content" && viewState.snapshot.kind === "execution" ? (
        <AttackExecutionViewPanel view={viewState.snapshot} onOpenFinding={handleOpenFinding} />
      ) : null}

      {viewState.kind === "content" && viewState.snapshot.kind === "finding" ? (
        <AttackFindingViewPanel
          view={viewState.snapshot}
          onReplay={() => void handleReplay()}
          replaying={replaying}
          onBack={handleBackToOverview}
        />
      ) : null}
    </div>
  );
}
