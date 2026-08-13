"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { REVIEW_STAGE_KEYS, resolveReviewStageIndex } from "@/lib/onboarding/review-stages";
import { scanIsActive, scanIsCompleted } from "../onboarding-flow";
import {
  isGitHubReauthRequired,
  isSubscriptionRequired,
  resolveScanErrorMessage,
} from "@/lib/github/scan-api-response";
import { GitHubReauthBanner } from "@/features/github/components/GitHubReauthBanner";
import { ScanPaywallBanner } from "@/features/billing/components/ScanPaywallBanner";
import { useI18n } from "@/lib/i18n/client";
import { translateStoredProgressMessage } from "@/lib/i18n/review-progress";

type ScanPayload = {
  id: string;
  status: string;
  progress?: number | null;
  progress_message?: string | null;
  error_message?: string | null;
};

const STALL_MS = 8 * 60 * 1000;
const QUEUE_STALL_MS = 2 * 60 * 1000;

export function OnboardingReviewStep({
  projectId,
  existingScanId,
  onComplete,
}: {
  projectId: string;
  existingScanId?: string | null;
  onComplete: (scanId: string, verdict: ProductionVerdictV1) => void;
}) {
  const { t, locale } = useI18n("onboarding");
  const { t: te } = useI18n("errors");
  const [scanId, setScanId] = useState<string | null>(existingScanId ?? null);
  const [scan, setScan] = useState<ScanPayload | null>(null);
  const [error, setError] = useState("");
  const [reauthRequired, setReauthRequired] = useState(false);
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [queueStalled, setQueueStalled] = useState(false);
  const [starting, setStarting] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  const startScan = useCallback(async () => {
    setError("");
    setReauthRequired(false);
    setSubscriptionRequired(false);
    setStalled(false);
    setQueueStalled(false);
    setStarting(true);
    startedAtRef.current = Date.now();
    try {
      const response = await fetch(`/api/repositories/${projectId}/scans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanType: "full" }),
      });
      const body = (await response.json().catch(() => null)) as
        | { scan_id?: string; error?: string; needsReauth?: boolean; code?: string }
        | null;

      if (isSubscriptionRequired(body)) {
        setSubscriptionRequired(true);
        setError(
          resolveScanErrorMessage(body, {
            defaultMessage: te("scanStart"),
            subscriptionRequired: te("subscriptionRequired"),
          })
        );
        return;
      }

      if (isGitHubReauthRequired(body)) {
        setReauthRequired(true);
        setError(
          resolveScanErrorMessage(body, {
            defaultMessage: te("scanStart"),
            reauth: te("githubReconnect"),
          })
        );
        return;
      }

      if (!response.ok || !body?.scan_id) {
        setReauthRequired(false);
        throw new Error(
          resolveScanErrorMessage(body, {
            defaultMessage: te("scanStart"),
            rateLimited: te("scanRateLimited"),
            infrastructureMissing: t("reviewInfrastructureMissing"),
          })
        );
      }

      setScanId(body.scan_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : te("scanStart"));
    } finally {
      setStarting(false);
    }
  }, [projectId, t, te]);

  const pollScan = useCallback(async () => {
    if (!scanId) return;
    if (startedAtRef.current == null) {
      startedAtRef.current = Date.now();
    }
    if (Date.now() - startedAtRef.current > STALL_MS) {
      setStalled(true);
    }

    const response = await fetch(`/api/repositories/${projectId}/scans/${scanId}`, {
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as
      | {
          scan?: ScanPayload;
          scanJob?: { id: string; status: string } | null;
          verdict?: { v1?: ProductionVerdictV1 | null } | null;
          error?: string;
        }
      | null;

    if (!response.ok || !body?.scan) {
      if (response.status === 404) {
        setScanId(null);
        return;
      }
      setError(body?.error || te("scanLoad"));
      return;
    }

    setScan(body.scan);

    const elapsed = Date.now() - (startedAtRef.current ?? Date.now());
    const scanStatus = body.scan.status?.toLowerCase() ?? "";
    const jobStatus = body.scanJob?.status?.toLowerCase() ?? null;
    if (
      elapsed > QUEUE_STALL_MS &&
      scanStatus === "queued" &&
      (!body.scanJob || jobStatus === "queued")
    ) {
      setQueueStalled(true);
      setStalled(true);
    }

      if (body.scan.status === "failed") {
        const code = (body.scan as { error_code?: string }).error_code;
        if (code === "WORKER_NEVER_STARTED") {
          setError(t("reviewQueueStalledBody"));
          return;
        }
        setError(body.scan.error_message || te("scanStart"));
        return;
      }

    const verdict = body.verdict?.v1 ?? null;
    if (scanIsCompleted(body.scan.status) && verdict) {
      onComplete(scanId, verdict);
    }
  }, [onComplete, projectId, scanId, te]);

  useEffect(() => {
    const pending = localStorage.getItem(`sequrai_github_scan_${projectId}`);
    if (pending) {
      localStorage.removeItem(`sequrai_github_scan_${projectId}`);
    }
    if (!scanId) {
      queueMicrotask(() => void startScan());
    }
  }, [projectId, scanId, startScan]);

  useEffect(() => {
    if (!scanId) return;
    queueMicrotask(() => void pollScan());
    const timer = window.setInterval(() => void pollScan(), 4000);
    return () => window.clearInterval(timer);
  }, [pollScan, scanId]);

  const stageState = useMemo(
    () => resolveReviewStageIndex(scan?.status, scan?.progress),
    [scan?.progress, scan?.status]
  );

  const progress = Math.max(12, Math.min(100, scan?.progress ?? (starting ? 8 : 18)));
  const active = scan ? scanIsActive(scan.status) : true;
  const currentStageKey = REVIEW_STAGE_KEYS[stageState.activeIndex] ?? REVIEW_STAGE_KEYS[0];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent p-6 md:p-8 shadow-[0_0_60px_-24px_rgba(var(--primary-rgb,99,102,241),0.45)]">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(var(--primary-rgb,99,102,241),0.12),transparent_55%)]"
          aria-hidden
        />
        <div className="relative flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <Shield className="h-5 w-5 text-primary animate-pulse" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t("reviewTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("reviewSub")}</p>
          </div>
        </div>

        {(active || starting) && (
          <div className="space-y-4">
            <p className="text-sm font-medium animate-pulse">{t(`reviewStages.${currentStageKey}`)}</p>
            <div className="space-y-2">
              <Progress value={progress} aria-label={t("reviewing")} />
              <p className="text-xs text-muted-foreground">
                {starting
                  ? t("startingReview")
                  : scan?.status?.toLowerCase() === "queued"
                    ? t("reviewQueued")
                    : scan?.progress_message
                      ? translateStoredProgressMessage(locale, scan.progress_message)
                      : t("analyzingRepo")}
              </p>
            </div>
          </div>
        )}
      </div>

      {stalled && !error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">{t("reviewStalledTitle")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {queueStalled ? t("reviewQueueStalledBody") : t("reviewStalledBody")}
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void startScan()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            {t("retryReview")}
          </Button>
        </div>
      )}

      {subscriptionRequired ? (
        <ScanPaywallBanner
          message={error || undefined}
          returnPath={`/onboarding?step=review&projectId=${projectId}`}
        />
      ) : null}

      {reauthRequired ? (
        <GitHubReauthBanner
          returnPath={`/onboarding?step=review&projectId=${projectId}`}
          message={error || undefined}
        />
      ) : null}

      {error && !reauthRequired && !subscriptionRequired && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">{t("reviewFailedTitle")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("reviewFailedBody")}</p>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t("technicalDetails")}</summary>
            <p className="mt-2">{error}</p>
          </details>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void startScan()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            {t("retryReview")}
          </Button>
        </div>
      )}
    </div>
  );
}
