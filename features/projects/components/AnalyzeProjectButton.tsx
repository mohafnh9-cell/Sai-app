"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
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
import { CancelReviewButton } from "@/features/projects/components/CancelReviewButton";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import type { ProductionReviewUiContract } from "@/server/projects/build-production-review-ui-contract";

const scanRetryKey = (projectId: string) => `sequrai_github_scan_${projectId}`;

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

export function AnalyzeProjectButton({
  projectId,
  initialContext,
  showCommitHint = true,
  className,
  size = "default",
  labelOverride,
}: {
  projectId: string;
  initialContext: ProjectReviewUiContext;
  showCommitHint?: boolean;
  className?: string;
  size?: "default" | "sm" | "lg";
  labelOverride?: string;
}) {
  const { t } = useI18n("projects");
  const { t: te } = useI18n("errors");
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
    const response = await fetch(`/api/projects/${projectId}/production-review-state`, {
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as {
      state?: ProductionReviewState;
      contract?: ProductionReviewUiContract | null;
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
    const inProgress = contract?.reviewInProgress ?? false;
    setReviewInProgress(inProgress);
    setReviewState({
      ...state,
      hasActiveReview: inProgress,
      isCancellable: contract?.canCancelReview ?? state.isCancellable,
      scanJobId: contract?.activeReview?.scanJobId ?? state.scanJobId,
      commitSha: contract?.activeReview?.commitSha ?? state.commitSha,
      status: inProgress ? state.status : state.hasActiveReview ? "idle" : state.status,
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
                progress: null,
                progressMessage: null,
                commitSha: contract.activeReview.commitSha,
              }
            : null,
      }));
    } else if (!inProgress) {
      setContext((prev) => ({ ...prev, activeScan: null }));
    }
    return state;
  }, [projectId]);

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

  const label = useMemo(() => {
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
  }, [context.hasVerdict, context.isStale, disconnected, labelOverride, requesting, reviewInProgress, t, uiStatus]);

  const showSpinner =
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
      : requesting ||
        reviewInProgress ||
        (reviewState.hasActiveReview && uiStatus !== "cancelled" && uiStatus !== "failed");

  const requestReview = useCallback(async () => {
    if (requestedRef.current || requesting) return;
    if (disconnected) {
      await reconnectGitHub();
      return;
    }
    if (reviewInProgress) return;

    requestedRef.current = true;
    setRequesting(true);
    setError("");
    setErrorRef(null);
    setCancelError("");

    trackEvent(context.hasVerdict ? "analyze_again_clicked" : "first_review_requested", {
      projectId,
    });

    try {
      const response = await fetch(`/api/repositories/${projectId}/scans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanType: "full" }),
      });
      const body = (await response.json().catch(() => null)) as
        | {
            scan_id?: string;
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

      if (response.status === 409 && body?.scan?.id) {
        await syncReviewState();
        return;
      }

      if (!response.ok || !body?.scan_id) {
        if (body?.code === "SCAN_JOB_INFRASTRUCTURE_MISSING") {
          throw new Error(t("reviewInfrastructureMissing"));
        }
        throw new Error(body?.error || te("scanStart"));
      }

      trackEvent("first_review_started", { projectId, scanId: body.scan_id });
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
    context.hasVerdict,
    disconnected,
    projectId,
    reconnectGitHub,
    requesting,
    reviewInProgress,
    syncReviewState,
    t,
    te,
  ]);

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
    trackEvent("first_review_completed", { projectId, scanId: reviewState.scanId });
    window.location.assign(`/projects/${projectId}/mission-control?reviewComplete=1`);
  }, [projectId, reviewState.scanId, reviewState.status]);

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
    <div className={className}>
      <Button
        onClick={() => void requestReview()}
        disabled={primaryDisabled}
        size={size}
        variant={uiStatus === "failed" || uiStatus === "stale" ? "destructive" : "default"}
        aria-busy={showSpinner}
      >
        {showSpinner ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {label}
      </Button>
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
