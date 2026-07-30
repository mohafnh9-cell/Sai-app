"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttackCenterSnapshot } from "./types";
import type { AttackCenterCapability, AttackCenterRefreshError } from "./api-types";
import { resolveViewState } from "./view-state";
import { useAttackCenterLive } from "./hooks/useAttackCenterLive";
import { AttackCampaignView } from "./components/AttackCampaignView";
import { AttackExecutionViewPanel } from "./components/AttackExecutionViewPanel";
import { AttackFindingViewPanel } from "./components/AttackFindingViewPanel";
import { AnalyzeProjectButton } from "@/features/projects/components/AnalyzeProjectButton";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";

export function AttackCenterExperience({
  projectId,
  initialSnapshot,
  initialCampaignId,
  initialCapability = null,
  reviewContext,
}: {
  projectId: string;
  initialSnapshot: AttackCenterSnapshot | null;
  initialCampaignId?: string | null;
  initialCapability?: AttackCenterCapability | null;
  reviewContext: ProjectReviewUiContext;
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

  const { snapshot, capability, loading, error, transport, refresh, setSnapshot } =
    useAttackCenterLive({
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

  const handleCancelCampaign = useCallback(async () => {
    if (!campaignId) return;
    setActionError(null);
    const response = await fetch(`/api/projects/${projectId}/attack-campaigns/${campaignId}/cancel`, {
      method: "POST",
    });
    const body = (await response.json().catch(() => null)) as { snapshot?: AttackCenterSnapshot; error?: string };
    if (!response.ok) {
      setActionError(body?.error ?? "Could not cancel campaign");
      return;
    }
    if (body.snapshot) setSnapshot(body.snapshot);
  }, [campaignId, projectId, setSnapshot]);

  const handleCancelExecution = useCallback(async () => {
    if (!executionId) return;
    setActionError(null);
    const response = await fetch(
      `/api/projects/${projectId}/attack-executions/${executionId}/cancel`,
      { method: "POST" }
    );
    const body = (await response.json().catch(() => null)) as { snapshot?: AttackCenterSnapshot; error?: string };
    if (!response.ok) {
      setActionError(body?.error ?? "Could not cancel execution");
      return;
    }
    if (body.snapshot) setSnapshot(body.snapshot);
  }, [executionId, projectId, setSnapshot]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={`/projects/${projectId}/mission-control`}
          className="text-muted-foreground hover:text-foreground"
        >
          Mission Control
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">Attack Center</span>
        <span className="ml-auto text-xs text-muted-foreground capitalize">
          Live via {transport}
        </span>
      </div>

      {viewState.kind === "content" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={!executionId && !findingId ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setExecutionId(null);
              setFindingId(null);
              void refresh();
            }}
          >
            Campaign
          </Button>
          {executionId ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setFindingId(null)}>
              Execution
            </Button>
          ) : null}
          {findingId ? (
            <Button type="button" variant="default" size="sm">
              Finding
            </Button>
          ) : null}
          {!findingId && campaignId && !executionId ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCancelCampaign()}>
              Cancel campaign
            </Button>
          ) : null}
          {executionId && !findingId ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCancelExecution()}>
              Cancel execution
            </Button>
          ) : null}
        </div>
      ) : null}

      {viewState.kind === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading attack center…
        </div>
      ) : null}

      {viewState.kind === "disabled" ? (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-8 text-center text-sm">
          <p className="font-medium text-foreground">Attack Simulation is not enabled for this project.</p>
          <p className="mt-2 text-muted-foreground">
            Enable the attack_simulation feature flag for your organization to run safe attack scenarios.
          </p>
        </div>
      ) : null}

      {viewState.kind === "error" ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-3">
          <p className="text-sm font-medium text-foreground">
            {viewState.error.fatal
              ? "Attack Center storage is unavailable."
              : "Attack Center could not refresh."}
          </p>
          <p className="text-sm text-muted-foreground">{viewState.error.message}</p>
          <div className="flex flex-wrap gap-2">
            {!viewState.error.fatal ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            ) : null}
            {viewState.error.details ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowErrorDetails((value) => !value)}
              >
                {showErrorDetails ? "Hide details" : "View technical details"}
              </Button>
            ) : null}
          </div>
          {showErrorDetails && viewState.error.details ? (
            <p className="text-xs text-muted-foreground font-mono">{viewState.error.details}</p>
          ) : null}
        </div>
      ) : null}

      {viewState.kind === "empty" ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-4">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No attack campaigns yet</p>
            <p>
              Safe attack scenarios are created automatically when a Production Review completes
              with Red Team findings.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <AnalyzeProjectButton
              projectId={projectId}
              initialContext={reviewContext}
              showCommitHint={false}
              size="sm"
            />
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href={`/projects/${projectId}/scans`}>View review history</Link>
            </Button>
          </div>
        </div>
      ) : null}

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

      {viewState.kind === "content" && viewState.snapshot.kind === "campaign" ? (
        <AttackCampaignView
          view={viewState.snapshot}
          onSelectExecution={(id) => {
            setExecutionId(id);
            setFindingId(null);
          }}
        />
      ) : null}

      {viewState.kind === "content" && viewState.snapshot.kind === "execution" ? (
        <AttackExecutionViewPanel view={viewState.snapshot} />
      ) : null}

      {viewState.kind === "content" && viewState.snapshot.kind === "finding" ? (
        <AttackFindingViewPanel
          view={viewState.snapshot}
          onReplay={() => void handleReplay()}
          replaying={replaying}
        />
      ) : null}
    </div>
  );
}
