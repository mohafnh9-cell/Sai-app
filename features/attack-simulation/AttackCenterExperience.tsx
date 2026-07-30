"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttackCenterSnapshot } from "./types";
import { useAttackCenterLive } from "./hooks/useAttackCenterLive";
import { AttackCampaignView } from "./components/AttackCampaignView";
import { AttackExecutionViewPanel } from "./components/AttackExecutionViewPanel";
import { AttackFindingViewPanel } from "./components/AttackFindingViewPanel";

export function AttackCenterExperience({
  projectId,
  initialSnapshot,
  initialCampaignId,
}: {
  projectId: string;
  initialSnapshot: AttackCenterSnapshot | null;
  initialCampaignId?: string | null;
}) {
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [findingId, setFindingId] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const campaignId = useMemo(() => {
    if (initialCampaignId) return initialCampaignId;
    if (initialSnapshot?.kind === "campaign") return initialSnapshot.campaign.id;
    if (initialSnapshot?.kind === "execution") return initialSnapshot.execution.campaignId;
    return null;
  }, [initialCampaignId, initialSnapshot]);

  const { snapshot, loading, error, transport, refresh, setSnapshot } = useAttackCenterLive({
    projectId,
    campaignId: findingId ? null : executionId ? null : campaignId,
    executionId: findingId ? null : executionId,
    findingId,
    initialSnapshot,
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

  const activeView = snapshot ?? initialSnapshot;

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

      {loading && !activeView ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading attack center…
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

      {!activeView ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No attack campaigns yet. Start a Production Review to plan safe attack scenarios.
        </div>
      ) : null}

      {activeView?.kind === "campaign" ? (
        <AttackCampaignView
          view={activeView}
          onSelectExecution={(id) => {
            setExecutionId(id);
            setFindingId(null);
          }}
        />
      ) : null}

      {activeView?.kind === "execution" ? <AttackExecutionViewPanel view={activeView} /> : null}

      {activeView?.kind === "finding" ? (
        <AttackFindingViewPanel view={activeView} onReplay={() => void handleReplay()} replaying={replaying} />
      ) : null}
    </div>
  );
}
