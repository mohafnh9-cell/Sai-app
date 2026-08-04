"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AttackCenterSnapshot } from "../types";
import type {
  AttackCenterCapability,
  AttackCenterListApiResponse,
  AttackCenterRefreshError,
} from "../api-types";
import {
  ATTACK_CENTER_POLL_INTERVAL_MS,
  ATTACK_CENTER_REALTIME_CHANNEL,
} from "../constants";
import { appendAnalysisRunSearchParams } from "@/features/analysis-runs/lib/build-run-query";

type LiveOptions = {
  projectId: string;
  analysisRunId?: string | null;
  campaignId?: string | null;
  executionId?: string | null;
  findingId?: string | null;
  initialSnapshot?: AttackCenterSnapshot | null;
  initialCapability?: AttackCenterCapability | null;
  enabled?: boolean;
};

function resolvePollUrl(options: LiveOptions): string | null {
  const { projectId, analysisRunId, campaignId, executionId, findingId } = options;
  if (!projectId) return null;
  if (findingId) {
    return `/api/projects/${projectId}/attack-findings/${findingId}`;
  }
  if (executionId) {
    return `/api/projects/${projectId}/attack-executions/${executionId}`;
  }
  if (campaignId) {
    return `/api/projects/${projectId}/attack-campaigns/${campaignId}`;
  }
  const params = new URLSearchParams();
  appendAnalysisRunSearchParams(params, analysisRunId);
  const qs = params.toString();
  return `/api/projects/${projectId}/attack-campaigns${qs ? `?${qs}` : ""}`;
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

function parseRefreshError(status: number, body: AttackCenterListApiResponse): AttackCenterRefreshError {
  const fatal = status === 503 || body.code === "infrastructure_unavailable";
  return {
    status,
    fatal,
    code: body.code,
    message:
      body.error ??
      (fatal
        ? "Security Test storage is unavailable. Apply ASE migrations in Supabase."
        : "Security Test could not refresh."),
    details: body.details ?? null,
  };
}

function snapshotFromResponse(body: AttackCenterListApiResponse): AttackCenterSnapshot | null {
  return body.snapshot ?? body.activeCampaign ?? null;
}

export function useAttackCenterLive(options: LiveOptions) {
  const {
    projectId,
    analysisRunId,
    campaignId,
    executionId,
    findingId,
    initialSnapshot = null,
    initialCapability = null,
    enabled = true,
  } = options;

  const [snapshot, setSnapshot] = useState<AttackCenterSnapshot | null>(initialSnapshot);
  const [capability, setCapability] = useState<AttackCenterCapability | null>(initialCapability);
  const [loading, setLoading] = useState(!initialSnapshot && enabled);
  const [error, setError] = useState<AttackCenterRefreshError | null>(null);
  const [transport, setTransport] = useState<"poll" | "realtime">("poll");
  const failureCountRef = useRef(0);
  const pollDelayRef = useRef(ATTACK_CENTER_POLL_INTERVAL_MS);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const refresh = useCallback(async () => {
    const url = resolvePollUrl({ projectId, campaignId, executionId, findingId });
    if (!url) return null;

    try {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      const body = (await response.json().catch(() => ({}))) as AttackCenterListApiResponse;

      if (body.capability) {
        setCapability(body.capability);
        if (!body.capability.enabled) {
          setSnapshot(null);
          setError(null);
          failureCountRef.current = 0;
          pollDelayRef.current = ATTACK_CENTER_POLL_INTERVAL_MS;
          return null;
        }
      }

      if (!response.ok) {
        const refreshError = parseRefreshError(response.status, body);
        setError(refreshError);
        failureCountRef.current += 1;
        pollDelayRef.current = Math.min(
          ATTACK_CENTER_POLL_INTERVAL_MS * 2 ** failureCountRef.current,
          30_000
        );
        return null;
      }

      const next = snapshotFromResponse(body);
      setSnapshot(next);
      setError(null);
      failureCountRef.current = 0;
      pollDelayRef.current = ATTACK_CENTER_POLL_INTERVAL_MS;
      return next;
    } catch (refreshError) {
      const message =
        refreshError instanceof Error ? refreshError.message : "Security Test could not refresh.";
      setError({
        status: 0,
        fatal: false,
        message,
      });
      failureCountRef.current += 1;
      pollDelayRef.current = Math.min(
        ATTACK_CENTER_POLL_INTERVAL_MS * 2 ** failureCountRef.current,
        30_000
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId, analysisRunId, campaignId, executionId, findingId]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    void refresh();
  }, [enabled, projectId, refresh]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    if (error?.fatal) return;

    const active =
      isActiveCampaign(snapshotRef.current) || isActiveExecution(snapshotRef.current);
    if (!active && snapshotRef.current) return;

    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        await refresh();
        if (!cancelled && !error?.fatal) schedule();
      }, pollDelayRef.current);
    };

    schedule();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, projectId, refresh, error?.fatal, snapshot?.kind, snapshot]);

  useEffect(() => {
    if (!enabled || !projectId) return;

    const supabase = createClient();
    const postgresFilter = campaignId
      ? `campaign_id=eq.${campaignId}`
      : `project_id=eq.${projectId}`;

    const channel = supabase
      .channel(
        `${ATTACK_CENTER_REALTIME_CHANNEL}:${projectId}:${analysisRunId ?? "project"}:${campaignId ?? "all"}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attack_simulation_runtime_events",
          filter: postgresFilter,
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
  }, [enabled, projectId, analysisRunId, campaignId, refresh]);

  return {
    snapshot,
    capability,
    loading,
    error,
    transport,
    refresh,
    setSnapshot,
  };
}
