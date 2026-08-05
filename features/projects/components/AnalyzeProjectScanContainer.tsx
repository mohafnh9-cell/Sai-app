"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { analysisRunKeys } from "@/features/analysis-runs/lib/query-keys";
import { appendAnalysisRunSearchParams } from "@/features/analysis-runs/lib/build-run-query";
import { Button } from "@/components/ui/button";
import { startGitHubOAuth } from "@/lib/github/oauth-client";
import { trackEvent } from "@/lib/analytics/track";
import { useI18n } from "@/lib/i18n/client";
import {
  productionReviewHasActiveWork,
  productionReviewShowsSpinner,
  type ProductionReviewState,
  type ProductionReviewUiStatus,
} from "@/lib/review/production-review-state";
import {
  deriveScanCodeButtonState,
  scanCodeButtonDisabled,
  scanCodeButtonLabelKey,
} from "@/lib/review/scan-code-button-state";
import { CancelReviewButton } from "@/features/projects/components/CancelReviewButton";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import type { ProductionReviewUiContract } from "@/server/projects/build-production-review-ui-contract";

const scanRetryKey = (projectId: string) => `sequrai_github_scan_${projectId}`;

function reviewCompleteRedirectKey(projectId: string, scanId: string) {
  return `sequrai_review_complete_redirect_${projectId}_${scanId}`;
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

const IDLE_STATE: ProductionReviewState = {
  hasActiveReview: false,
  scanId: null,
  scanJobId: null,
  status: "idle",
  isCancellable: false,
  commitSha: null,
  createdAt: null,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  failureMessage: null,
};

function shortSha(sha: string | null | undefined): string | null {
  if (!sha) return null;
  return sha.slice(0, 7);
}

function statusLabelKey(status: ProductionReviewUiStatus): string {
  switch (status) {
    case "idle":
      return "startNewReview";
    case "queued":
      return "reviewQueued";
    case "running":
      return "reviewRunning";
    case "analyzing":
      return "reviewAnalyzing";
    case "cancelling":
      return "cancellingReview";
    case "cancelled":
      return "newReview";
    case "completed":
      return "reviewComplete";
    case "failed":
    case "stale":
      return "startNewReview";
    default:
      return "analyzeProject";
  }
}

export function AnalyzeProjectScanContainer({
  projectId,
  initialContext,
  showCommitHint = true,
  className,
  size = "default",
  labelOverride,
  analysisRunIsolationEnabled = false,
  analysisRunId = null,
  buttonVariant = "default",
}: {
  projectId: string;
  initialContext: ProjectReviewUiContext;
  showCommitHint?: boolean;
  className?: string;
  size?: "default" | "sm" | "lg";
  labelOverride?: string;
  analysisRunIsolationEnabled?: boolean;
  analysisRunId?: string | null;
  buttonVariant?: "default" | "scanCard";
}) {
  const router = useRouter();
  const { t } = useI18n("projects");
  const { t: tm } = useI18n("missionControl");
  const { t: te } = useI18n("errors");
  const queryClient = useQueryClient();
  const [context, setContext] = useState(initialContext);
  const [reviewState, setReviewState] = useState<ProductionReviewState>(
    initialContext.productionReviewState ?? IDLE_STATE
  );
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [errorRef, setErrorRef] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState("");
  const [cancelInFlight, setCancelInFlight] = useState(false);
  const [reviewInProgress, setReviewInProgress] = useState(false);
  const requestedRef = useRef(false);

  const disconnected = context.githubNeedsReconnect || !context.githubConnected;

  const syncReviewState = useCallback(async () => {
    const params = new URLSearchParams();
    if (analysisRunIsolationEnabled) {
      appendAnalysisRunSearchParams(params, analysisRunId);
    }
    const qs = params.toString();
    const response = await fetch(
      `/api/projects/${projectId}/production-review-state${qs ? `?${qs}` : ""}`,
      { cache: "no-store" }
    );
    const body = (await response.json().catch(() => null)) as {
      state?: ProductionReviewState;
      contract?: ProductionReviewUiContract | null;
      activeScanProgress?: { progress: number | null; progressMessage: string | null } | null;
      githubSync?: {
        githubHeadSha: string | null;
        analyzedCommitSha: string | null;
        repositoryOutOfSync: boolean;
        syncInProgress?: boolean;
      };
    } | null;
    if (!response.ok || !body?.state) {
      return null;
    }
    const state = body.state;
    const contract = body.contract ?? null;
    const githubSync = body.githubSync;
    const activeScanProgress = body.activeScanProgress ?? null;
    const inProgress = contract?.reviewInProgress ?? false;
    setReviewInProgress(inProgress);
    setReviewState({
      ...state,
      hasActiveReview: inProgress,
      isCancellable: contract?.canCancelReview ?? state.isCancellable,
      scanJobId: contract?.activeReview?.scanJobId ?? state.scanJobId,
      commitSha: contract?.activeReview?.commitSha ?? state.commitSha,
      status: inProgress
        ? state.status
        : ["completed", "failed", "cancelled", "stale"].includes(state.status)
          ? state.status
          : state.status,
    });
    if (githubSync) {
      setContext((prev) => ({
        ...prev,
        latestCommitSha: githubSync.githubHeadSha ?? prev.latestCommitSha,
        githubHeadSha: githubSync.githubHeadSha,
        repositoryOutOfSync: contract?.repositoryOutOfSync ?? githubSync.repositoryOutOfSync,
        syncInProgress: inProgress,
        reviewedCommitSha:
          contract?.latestCompletedReview?.commitSha ??
          githubSync.analyzedCommitSha ??
          prev.reviewedCommitSha,
        hasCompletedAnalysis:
          Boolean(contract?.latestCompletedReview) ||
          prev.hasCompletedAnalysis ||
          (!inProgress && state.status === "completed"),
        lastAnalysisAt:
          contract?.latestCompletedReview?.completedAt ?? prev.lastAnalysisAt,
        isStale:
          Boolean(githubSync.githubHeadSha) &&
          Boolean(
            contract?.latestCompletedReview?.commitSha ?? githubSync.analyzedCommitSha
          ) &&
          (contract?.repositoryOutOfSync ?? githubSync.repositoryOutOfSync) &&
          !inProgress,
        activeScan:
          inProgress && contract?.activeReview
            ? {
                id: contract.activeReview.scanId,
                scanJobId: contract.activeReview.scanJobId,
                scanJobStatus: null,
                status: contract.activeReview.status,
                progress: activeScanProgress?.progress ?? null,
                progressMessage: activeScanProgress?.progressMessage ?? null,
                commitSha: contract.activeReview.commitSha,
              }
            : null,
      }));
    } else if (!inProgress) {
      setContext((prev) => ({ ...prev, activeScan: null }));
    }
    return state;
  }, [analysisRunId, analysisRunIsolationEnabled, projectId]);

  const reconnectGitHub = useCallback(async () => {
    localStorage.setItem(scanRetryKey(projectId), "1");
    await startGitHubOAuth(`/projects/${projectId}`);
  }, [projectId]);

  const uiStatus: ProductionReviewUiStatus = useMemo(() => {
    if (disconnected) return "idle";
    if (requesting) return "queued";
    if (cancelInFlight || reviewState.status === "cancelling") return "cancelling";
    return reviewState.status;
  }, [cancelInFlight, disconnected, requesting, reviewState.status]);

  const scanCardState =
    buttonVariant === "scanCard"
      ? deriveScanCodeButtonState({
          uiStatus,
          requesting,
          reviewInProgress,
          hasCompletedAnalysis: context.hasCompletedAnalysis,
        })
      : null;

  const label = useMemo(() => {
    if (scanCardState) {
      if (disconnected) return t("reconnectGitHub");
      return tm(scanCodeButtonLabelKey(scanCardState));
    }
    if (labelOverride && (uiStatus === "idle" || uiStatus === "queued" || uiStatus === "running" || uiStatus === "analyzing")) {
      if (disconnected) return t("reconnectGitHub");
      if (requesting && !reviewInProgress) return t("startingReview");
      if (uiStatus !== "idle") return t(statusLabelKey(uiStatus));
      return labelOverride;
    }
    if (disconnected) return t("reconnectGitHub");
    if (requesting && !reviewInProgress) return t("startingReview");
    if (context.isStale && uiStatus === "idle") return t("analyzeLatestCommit");
    if (context.hasVerdict && uiStatus === "idle") return t("analyzeAgain");
    if (uiStatus === "idle" && !context.hasVerdict) return t("analyzeProject");
    return t(statusLabelKey(uiStatus));
  }, [context.hasVerdict, context.isStale, disconnected, labelOverride, requesting, reviewInProgress, scanCardState, t, tm, uiStatus]);

  const showSpinner =
    scanCardState === "running" ||
    (reviewInProgress &&
      productionReviewHasActiveWork(reviewState.status, true)) ||
    (cancelInFlight && productionReviewShowsSpinner("cancelling"));

  const showCancel =
    reviewInProgress &&
    (reviewState.isCancellable || Boolean(reviewState.scanJobId)) &&
    Boolean(reviewState.scanId) &&
    Boolean(reviewState.scanJobId) &&
    !cancelInFlight;

  const primaryDisabled =
    disconnected
      ? false
      : scanCardState
        ? scanCodeButtonDisabled(scanCardState)
        : requesting ||
          reviewInProgress ||
          (reviewState.hasActiveReview &&
            uiStatus !== "cancelled" &&
            uiStatus !== "failed" &&
            uiStatus !== "completed");

  const requestReview = useCallback(async () => {
    if (requestedRef.current || requesting) return;
    if (disconnected) {
      await reconnectGitHub();
      return;
    }
    if (reviewInProgress) return;
    if (
      buttonVariant !== "scanCard" &&
      reviewState.hasActiveReview &&
      uiStatus !== "cancelled" &&
      uiStatus !== "failed" &&
      uiStatus !== "completed"
    ) {
      return;
    }

    requestedRef.current = true;
    setRequesting(true);
    setError("");
    setErrorRef(null);
    setCancelError("");

    trackEvent(context.hasVerdict ? "analyze_again_clicked" : "first_review_requested", {
      projectId,
    });

    try {
      const endpoint = analysisRunIsolationEnabled
        ? `/api/projects/${projectId}/analysis-runs`
        : `/api/repositories/${projectId}/scans`;
      const payload = analysisRunIsolationEnabled
        ? { forceNew: true }
        : { scanType: "full", forceNew: true };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | {
            runId?: string;
            scan_id?: string;
            scanId?: string;
            scan?: { id: string; status: string };
            error?: string;
            code?: string;
            needsReauth?: boolean;
          }
        | null;

      if (body?.needsReauth || body?.code === "GITHUB_REAUTH_REQUIRED") {
        await reconnectGitHub();
        return;
      }

      const resolvedScanId = body?.runId ?? body?.scan_id ?? body?.scanId ?? body?.scan?.id;

      if (response.status === 409 && body?.scan?.id) {
        if (navigateMissionControlToRun(projectId, body.scan.id)) return;
        await syncReviewState();
        return;
      }

      if (response.ok && resolvedScanId) {
        if (analysisRunIsolationEnabled) {
          void queryClient.invalidateQueries({ queryKey: analysisRunKeys.list(projectId) });
        }
        void syncReviewState();
        if (navigateMissionControlToRun(projectId, resolvedScanId)) return;
        router.refresh();
        return;
      }

      if (!response.ok || !resolvedScanId) {
        if (body?.code === "SCAN_JOB_INFRASTRUCTURE_MISSING") {
          throw new Error(t("reviewInfrastructureMissing"));
        }
        throw new Error(body?.error || te("scanStart"));
      }

      trackEvent("first_review_started", { projectId, scanId: resolvedScanId });
      await syncReviewState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : te("scanStart"));
      setErrorRef(crypto.randomUUID().slice(0, 8));
      trackEvent("first_review_failed", {
        projectId,
        error: cause instanceof Error ? cause.message : "unknown",
      });
    } finally {
      setRequesting(false);
      requestedRef.current = false;
    }
  }, [
    buttonVariant,
    context.hasVerdict,
    disconnected,
    projectId,
    reconnectGitHub,
    requesting,
    reviewInProgress,
    reviewState.hasActiveReview,
    syncReviewState,
    t,
    te,
    uiStatus,
    analysisRunIsolationEnabled,
    queryClient,
    router,
  ]);

  // Legacy container: keep local polling state aligned when SSR props refresh.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync from SSR props
    setContext(initialContext);
    setReviewState(initialContext.productionReviewState ?? IDLE_STATE);
  }, [initialContext]);

  useEffect(() => {
    queueMicrotask(() => void syncReviewState());
  }, [syncReviewState]);

  useEffect(() => {
    if (!reviewInProgress) return;
    const timer = window.setInterval(() => void syncReviewState(), 4000);
    return () => window.clearInterval(timer);
  }, [reviewInProgress, syncReviewState]);

  useEffect(() => {
    if (reviewState.status !== "completed" || !reviewState.scanId) return;

    const redirectKey = reviewCompleteRedirectKey(projectId, reviewState.scanId);
    if (sessionStorage.getItem(redirectKey)) return;
    sessionStorage.setItem(redirectKey, "1");

    trackEvent("first_review_completed", { projectId, scanId: reviewState.scanId });

    if (typeof window !== "undefined" && window.location.pathname.includes("/mission-control")) {
      const url = new URL(window.location.href);
      if (!url.searchParams.get("run")) {
        url.searchParams.set("run", reviewState.scanId);
        window.history.replaceState({}, "", url.pathname + url.search);
      }
      void queryClient.invalidateQueries({ queryKey: analysisRunKeys.list(projectId) });
      router.refresh();
      return;
    }

    window.location.assign(
      `/projects/${projectId}/mission-control?reviewComplete=1&run=${reviewState.scanId}`
    );
  }, [projectId, queryClient, reviewState.scanId, reviewState.status, router]);

  const scanProgressLabel = useMemo(() => {
    if (buttonVariant !== "scanCard" || !reviewInProgress) return null;
    const message = context.activeScan?.progressMessage;
    const progress = context.activeScan?.progress;
    if (message) return message;
    if (progress != null) return `${progress}%`;
    return null;
  }, [buttonVariant, context.activeScan, reviewInProgress]);

  useEffect(() => {
    const pending = localStorage.getItem(scanRetryKey(projectId));
    if (!pending) return;
    localStorage.removeItem(scanRetryKey(projectId));
    queueMicrotask(() => void requestReview());
  }, [projectId, requestReview]);

  const handleCancelError = useCallback(
    (message: string) => {
      setCancelInFlight(false);
      setCancelError(message);
      void syncReviewState();
    },
    [syncReviewState]
  );

  const handleCancelled = useCallback(() => {
    setCancelInFlight(false);
    void syncReviewState();
  }, [syncReviewState]);

  const handleStaleCancel = useCallback(() => {
    setCancelInFlight(false);
    setCancelError(t("reviewNotActiveRefresh"));
    void syncReviewState();
  }, [syncReviewState, t]);

  const handleCancelling = useCallback(() => {
    setCancelInFlight(true);
    setCancelError("");
    setReviewState((prev) => ({
      ...prev,
      status: "cancelling",
      isCancellable: false,
      hasActiveReview: true,
    }));
  }, []);

  const commitLabel = useMemo(() => {
    if (!showCommitHint) return null;

    const githubSha = shortSha(context.githubHeadSha ?? context.latestCommitSha);
    const analyzedSha = shortSha(
      reviewState.commitSha ?? context.reviewedCommitSha
    );

    if (githubSha && analyzedSha) {
      const lines = [
        t("latestAnalyzedCommit", { sha: analyzedSha }),
        t("currentGitHubCommit", { sha: githubSha }),
      ];
      if (context.repositoryOutOfSync && !reviewInProgress && !productionReviewShowsSpinner(uiStatus)) {
        return `${lines.join(" · ")} — ${t("repositoryPendingReview")}`;
      }
      if (reviewInProgress) {
        const activeSha = shortSha(reviewState.commitSha ?? context.githubHeadSha ?? githubSha);
        return activeSha ? t("analyzingCommit", { sha: activeSha }) : t("reviewRunning");
      }
      if (!context.repositoryOutOfSync && githubSha && analyzedSha && githubSha === analyzedSha) {
        return `${lines.join(" · ")} — ${t("repositoryInSync")}`;
      }
      return lines.join(" · ");
    }

    const sha = githubSha ?? analyzedSha;
    if (!sha) return null;
    if (productionReviewShowsSpinner(uiStatus)) {
      return t("analyzingCommit", { sha });
    }
    if (context.isStale && context.latestCommitSha) {
      return t("latestCommitNotReviewed", { sha: shortSha(context.latestCommitSha) ?? sha });
    }
    if (context.reviewedCommitSha) {
      return t("lastReviewedCommit", { sha: shortSha(context.reviewedCommitSha) ?? sha });
    }
    return null;
  }, [context, reviewInProgress, reviewState.commitSha, showCommitHint, t, uiStatus]);

  const bannerMessage = useMemo(() => {
    if (uiStatus === "cancelled") return t("reviewCancelledBanner");
    if (uiStatus === "stale") return t("reviewStaleBanner");
    if (uiStatus === "failed" && reviewState.failureMessage) {
      if (reviewState.failureMessage.toLowerCase().includes("superseded")) {
        return null;
      }
      return reviewState.failureMessage;
    }
    return null;
  }, [reviewState.failureMessage, t, uiStatus]);

  return (
    <div className={buttonVariant === "scanCard" ? undefined : className}>
      <Button
        onClick={() => void requestReview()}
        disabled={primaryDisabled}
        size={size}
        variant={
          scanCardState === "failed" || uiStatus === "failed" || uiStatus === "stale"
            ? "destructive"
            : "default"
        }
        className={buttonVariant === "scanCard" ? className : undefined}
        aria-busy={showSpinner}
      >
        {showSpinner ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {label}
      </Button>
      {scanProgressLabel ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {scanProgressLabel}
        </p>
      ) : null}
      {showCancel && reviewState.scanId && reviewState.scanJobId ? (
        <CancelReviewButton
          projectId={projectId}
          scanJobId={reviewState.scanJobId}
          reviewId={reviewState.scanId}
          disabled={uiStatus === "cancelling"}
          onCancelling={handleCancelling}
          onCancelled={handleCancelled}
          onError={handleCancelError}
          onStale={handleStaleCancel}
        />
      ) : null}
      {bannerMessage && (
        <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {bannerMessage}
        </p>
      )}
      {commitLabel && <p className="mt-2 text-xs text-muted-foreground">{commitLabel}</p>}
      {context.freshnessUnknown && (
        <p className="mt-2 text-xs text-muted-foreground">{t("freshnessUnknown")}</p>
      )}
      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {error}
            {context.hasVerdict ? ` ${t("previousVerdictUnchanged")}` : ""}
            {errorRef ? ` (${t("supportReference", { id: errorRef })})` : ""}
          </span>
        </p>
      )}
      {cancelError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{cancelError}</span>
        </p>
      )}
    </div>
  );
}
