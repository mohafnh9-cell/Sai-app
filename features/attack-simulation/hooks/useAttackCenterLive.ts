"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AttackCenterSnapshot } from "../types";
import {
  ATTACK_CENTER_POLL_INTERVAL_MS,
  ATTACK_CENTER_REALTIME_CHANNEL,
} from "../constants";

type LiveOptions = {
  projectId: string;
  campaignId?: string | null;
  executionId?: string | null;
  findingId?: string | null;
  initialSnapshot?: AttackCenterSnapshot | null;
  enabled?: boolean;
};

function resolvePollUrl(options: LiveOptions): string | null {
  const { projectId, campaignId, executionId, findingId } = options;
  if (findingId) {
    return `/api/projects/${projectId}/attack-findings/${findingId}`;
  }
  if (executionId) {
    return `/api/projects/${projectId}/attack-executions/${executionId}`;
  }
  if (campaignId) {
    return `/api/projects/${projectId}/attack-campaigns/${campaignId}`;
  }
  return `/api/projects/${projectId}/attack-campaigns`;
}

function isActiveCampaign(snapshot: AttackCenterSnapshot | null): boolean {
  if (!snapshot || snapshot.kind !== "campaign") return false;
  return !["completed", "failed", "cancelled"].includes(snapshot.campaign.status);
}

function isActiveExecution(snapshot: AttackCenterSnapshot | null): boolean {
  if (!snapshot || snapshot.kind !== "execution") return false;
  return ![
    "completed",
    "failed",
    "blocked",
    "cancelled",
    "protected",
    "still_vulnerable",
    "not_exploitable",
    "fix_ready",
    "confirmed",
  ].includes(snapshot.execution.status);
}

export function useAttackCenterLive(options: LiveOptions) {
  const {
    projectId,
    campaignId,
    executionId,
    findingId,
    initialSnapshot = null,
    enabled = true,
  } = options;

  const [snapshot, setSnapshot] = useState<AttackCenterSnapshot | null>(initialSnapshot);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<"poll" | "realtime">("poll");
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const refresh = useCallback(async () => {
    const url = resolvePollUrl({ projectId, campaignId, executionId, findingId });
    if (!url) return;

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Refresh failed (${response.status})`);
      }
      const body = (await response.json()) as {
        snapshot?: AttackCenterSnapshot;
      };
      const next = body.snapshot ?? null;
      setSnapshot(next);
      setError(null);
      return next;
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed");
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId, campaignId, executionId, findingId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;

    const active =
      isActiveCampaign(snapshotRef.current) || isActiveExecution(snapshotRef.current);
    if (!active && snapshotRef.current) return;

    const timer = window.setInterval(() => {
      void refresh();
    }, ATTACK_CENTER_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [enabled, refresh, snapshot?.kind, snapshot]);

  useEffect(() => {
    if (!enabled || !projectId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`${ATTACK_CENTER_REALTIME_CHANNEL}:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attack_simulation_runtime_events",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          setTransport("realtime");
          void refresh();
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setTransport("poll");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, projectId, refresh]);

  return {
    snapshot,
    loading,
    error,
    transport,
    refresh,
    setSnapshot,
  };
}
