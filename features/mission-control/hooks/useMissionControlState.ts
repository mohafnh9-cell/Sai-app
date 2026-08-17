"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import { analysisRunKeys } from "@/features/analysis-runs/lib/query-keys";
import { appendAnalysisRunSearchParams } from "@/features/analysis-runs/lib/build-run-query";
import { startGitHubOAuth } from "@/lib/github/oauth-client";
import {
  isGitHubReauthRequired,
  isSubscriptionRequired,
  resolveScanErrorMessage,
} from "@/lib/github/scan-api-response";

const POLL_INTERVAL_MS = 4000;

function shouldPollMissionControl(state: MissionControlState | undefined): boolean {
  if (!state) return false;
  return state.status.reviewInProgress || state.status.securityRunning;
}

function navigateMissionControlToRun(projectId: string, scanId: string): boolean {
  if (typeof window === "undefined") return false;
  if (!window.location.pathname.includes("/mission-control")) return false;
  const url = new URL(window.location.href);
  url.searchParams.set("run", scanId);
  url.searchParams.delete("reviewComplete");
  window.location.replace(`${url.pathname}${url.search}`);
  return true;
}

export function useMissionControlState(
  projectId: string,
  options: {
    initialState: MissionControlState;
    analysisRunId?: string | null;
  }
) {
  const router = useRouter();
  const analysisRunId = options.analysisRunId ?? options.initialState.analysisRunId;
  const [scanStarting, setScanStarting] = useState(false);
  const [securityStarting, setSecurityStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);

  const query = useQuery({
    queryKey: analysisRunKeys.missionControl(projectId, analysisRunId),
    queryFn: async () => {
      const params = new URLSearchParams();
      appendAnalysisRunSearchParams(params, analysisRunId);
      const qs = params.toString();
      const response = await fetch(
        `/api/projects/${projectId}/mission-control${qs ? `?${qs}` : ""}`,
        { cache: "no-store", credentials: "same-origin" }
      );
      const body = (await response.json().catch(() => ({}))) as MissionControlState & {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to load Mission Control state");
      }
      const { ok: _ok, ...state } = body;
      return state as MissionControlState;
    },
    initialData: options.initialState,
    refetchInterval: (q) => (shouldPollMissionControl(q.state.data) ? POLL_INTERVAL_MS : false),
  });

  const state = query.data ?? options.initialState;

  const refresh = useCallback(async () => {
    await query.refetch();
    router.refresh();
  }, [query, router]);

  const startScan = useCallback(async () => {
    if (scanStarting || state.actions.scan.disabled) return;
    setActionError(null);
    setReauthRequired(false);
    setSubscriptionRequired(false);

    if (state.actions.scan.label === "cta" && !state.status.repositoryConnected) {
      await startGitHubOAuth(`/projects/${projectId}/mission-control`);
      return;
    }

    setScanStarting(true);
    try {
      const endpoint = state.flags.analysisRunIsolationEnabled
        ? `/api/projects/${projectId}/analysis-runs`
        : `/api/repositories/${projectId}/scans`;
      const forceNew =
        state.actions.scan.label === "rescan" ||
        state.actions.scan.label === "retry" ||
        state.ui.isVerdictStale;
      const payload = state.flags.analysisRunIsolationEnabled
        ? { forceNew }
        : { scanType: "full", forceNew };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        runId?: string;
        scan_id?: string;
        scanId?: string;
        scan?: { id: string };
        error?: string;
        message?: string;
        needsReauth?: boolean;
        code?: string;
        reused?: boolean;
        resumed?: boolean;
      } | null;

      if (isSubscriptionRequired(body)) {
        setSubscriptionRequired(true);
        setActionError(
          resolveScanErrorMessage(body, {
            defaultMessage: "Failed to start scan",
            subscriptionRequired: "Subscribe to Builder Edition to run Production Reviews.",
          })
        );
        return;
      }

      if (isGitHubReauthRequired(body)) {
        setReauthRequired(true);
        setActionError(
          resolveScanErrorMessage(body, {
            defaultMessage: "Failed to start scan",
            reauth: body?.error ?? "Reconnect GitHub to run a new review.",
          })
        );
        return;
      }

      if (body?.code === "SCAN_RATE_LIMITED") {
        setActionError(
          resolveScanErrorMessage(body, {
            defaultMessage: "Failed to start scan",
            rateLimited: "You reached the hourly scan limit for this repository. Try again later.",
          })
        );
        return;
      }

      const resolvedScanId = body?.runId ?? body?.scan_id ?? body?.scanId ?? body?.scan?.id;

      if (response.status === 409 && body?.scan?.id) {
        if (navigateMissionControlToRun(projectId, body.scan.id)) return;
        await refresh();
        return;
      }

      if (!response.ok || !resolvedScanId) {
        throw new Error(body?.error ?? "Failed to start scan");
      }

      if (body?.reused || body?.resumed) {
        setActionError(null);
    setReauthRequired(false);
    setSubscriptionRequired(false);
      }

      if (navigateMissionControlToRun(projectId, resolvedScanId)) return;
      await refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Failed to start scan");
    } finally {
      setScanStarting(false);
    }
  }, [projectId, refresh, scanStarting, state]);

  const startSecurityTest = useCallback(async () => {
    if (securityStarting || state.actions.security.disabled) return;
    setActionError(null);
    setSecurityStarting(true);
    try {
      const params = new URLSearchParams();
      appendAnalysisRunSearchParams(params, analysisRunId);
      const qs = params.toString();
      const baseHref =
        state.ui.attackCenterHref ?? `/projects/${projectId}/attack-center`;
      router.push(qs ? `${baseHref}?${qs}` : baseHref);
    } finally {
      setSecurityStarting(false);
    }
  }, [analysisRunId, projectId, router, securityStarting, state.actions.security.disabled, state.ui.attackCenterHref]);

  const scanAction = {
    ...state.actions.scan,
    disabled: state.actions.scan.disabled || scanStarting,
    showSpinner: state.actions.scan.showSpinner || scanStarting,
    label: scanStarting ? ("running" as const) : state.actions.scan.label,
  };

  const securityAction = {
    ...state.actions.security,
    disabled: state.actions.security.disabled || securityStarting,
    showSpinner: state.actions.security.showSpinner || securityStarting,
  };

  return {
    state,
    scanAction,
    securityAction,
    actionError,
    reauthRequired,
    subscriptionRequired,
    startScan,
    startSecurityTest,
    refresh,
    isFetching: query.isFetching,
  };
}
