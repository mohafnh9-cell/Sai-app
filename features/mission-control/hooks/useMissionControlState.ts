"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import { analysisRunKeys } from "@/features/analysis-runs/lib/query-keys";
import { appendAnalysisRunSearchParams } from "@/features/analysis-runs/lib/build-run-query";
import { DEFAULT_SECURITY_TEST_IDS } from "@/features/security-testing/user-test-catalog";
import { startGitHubOAuth } from "@/lib/github/oauth-client";

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
  const queryClient = useQueryClient();
  const analysisRunId = options.analysisRunId ?? options.initialState.analysisRunId;
  const [scanStarting, setScanStarting] = useState(false);
  const [securityStarting, setSecurityStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  useEffect(() => {
    queryClient.setQueryData(analysisRunKeys.list(projectId), state.analysisRuns);
  }, [projectId, queryClient, state.analysisRuns]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: analysisRunKeys.missionControl(projectId, analysisRunId),
    });
    await queryClient.invalidateQueries({ queryKey: analysisRunKeys.list(projectId) });
    router.refresh();
  }, [analysisRunId, projectId, queryClient, router]);

  const startScan = useCallback(async () => {
    if (scanStarting || state.actions.scan.disabled) return;
    setActionError(null);

    if (state.actions.scan.label === "cta" && !state.status.repositoryConnected) {
      await startGitHubOAuth(`/projects/${projectId}`);
      return;
    }

    setScanStarting(true);
    try {
      const endpoint = state.flags.analysisRunIsolationEnabled
        ? `/api/projects/${projectId}/analysis-runs`
        : `/api/repositories/${projectId}/scans`;
      const payload = state.flags.analysisRunIsolationEnabled
        ? { forceNew: true }
        : { scanType: "full", forceNew: true };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        runId?: string;
        scan_id?: string;
        scanId?: string;
        scan?: { id: string };
        error?: string;
        needsReauth?: boolean;
        code?: string;
      } | null;

      if (body?.needsReauth || body?.code === "GITHUB_REAUTH_REQUIRED") {
        await startGitHubOAuth(`/projects/${projectId}`);
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

      void queryClient.invalidateQueries({ queryKey: analysisRunKeys.list(projectId) });
      if (navigateMissionControlToRun(projectId, resolvedScanId)) return;
      await refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Failed to start scan");
    } finally {
      setScanStarting(false);
    }
  }, [projectId, queryClient, refresh, scanStarting, state]);

  const startSecurityTest = useCallback(async () => {
    if (securityStarting || state.actions.security.disabled) return;
    setActionError(null);
    setSecurityStarting(true);
    try {
      const params = new URLSearchParams();
      appendAnalysisRunSearchParams(params, analysisRunId);
      const qs = params.toString();
      const response = await fetch(
        `/api/projects/${projectId}/security-tests${qs ? `?${qs}` : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            testIds: DEFAULT_SECURITY_TEST_IDS.slice(0, 4),
            analysisRunId: analysisRunId ?? undefined,
          }),
        }
      );
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        code?: string;
        attackCenterHref?: string;
      } | null;

      if (body?.code === "needs_review") {
        throw new Error(body.error ?? "Complete a code scan first");
      }
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error ?? "Failed to start security test");
      }

      router.push(body.attackCenterHref ?? state.ui.attackCenterHref ?? `/projects/${projectId}/attack-center`);
      await refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Failed to start security test");
    } finally {
      setSecurityStarting(false);
    }
  }, [analysisRunId, projectId, refresh, router, securityStarting, state]);

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
    label: securityStarting ? ("running" as const) : state.actions.security.label,
  };

  return {
    state,
    scanAction,
    securityAction,
    actionError,
    startScan,
    startSecurityTest,
    refresh,
    isFetching: query.isFetching,
  };
}
