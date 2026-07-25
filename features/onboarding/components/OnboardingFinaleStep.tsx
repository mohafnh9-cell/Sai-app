"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { fixPromptInputFromPriority } from "@/brain/fix-prompt";
import { verdictExperienceFromVerdict } from "@/brain/production-verdict/experience-view";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ProductionVerdictHero } from "@/features/production-verdict/components/ProductionVerdictHero";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";
import { SafeFixMetrics } from "@/features/production-verdict/components/SafeFixMetrics";
import { scanIsCompleted } from "../onboarding-flow";
import { useI18n } from "@/lib/i18n/client";

type ScanPayload = {
  id: string;
  status: string;
  progress?: number | null;
  progress_message?: string | null;
};

export function OnboardingFinaleStep({
  verdict: initialVerdict,
  projectId,
  projectName,
  onVerdictUpdated,
  onConnectCursor,
  onGoToDashboard,
}: {
  verdict: ProductionVerdictV1;
  projectId: string;
  projectName: string;
  onVerdictUpdated: (verdict: ProductionVerdictV1) => void;
  onConnectCursor: () => void;
  onGoToDashboard: () => void;
}) {
  const { t } = useI18n("onboarding");
  const { t: te } = useI18n("errors");
  const [verdict, setVerdict] = useState(initialVerdict);
  const [rechecking, setRechecking] = useState(false);
  const [recheckProgress, setRecheckProgress] = useState(12);
  const [recheckError, setRecheckError] = useState("");

  const view = useMemo(() => verdictExperienceFromVerdict(verdict), [verdict]);
  const ready = view.status === "ready_to_ship";
  const topPriority = verdict.topPriorities[0] ?? null;

  const fixPromptInput = useMemo(() => {
    if (!topPriority || ready) return null;
    return fixPromptInputFromPriority(topPriority, {
      projectName,
      currentVerdictStatus: verdict.status,
      currentScore: verdict.score,
    });
  }, [topPriority, projectName, ready, verdict.score, verdict.status]);

  useEffect(() => {
    setVerdict(initialVerdict);
  }, [initialVerdict]);

  const pollUntilVerdict = useCallback(
    async (scanId: string) => {
      const response = await fetch(`/api/repositories/${projectId}/scans/${scanId}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | { scan?: ScanPayload; verdict?: { v1?: ProductionVerdictV1 | null } | null; error?: string }
        | null;

      if (!response.ok || !body?.scan) {
        throw new Error(body?.error || te("scanLoad"));
      }

      setRecheckProgress(Math.max(15, Math.min(100, body.scan.progress ?? recheckProgress)));

      if (body.scan.status === "failed") {
        throw new Error(te("scanStart"));
      }

      const nextVerdict = body.verdict?.v1 ?? null;
      if (scanIsCompleted(body.scan.status) && nextVerdict) {
        setVerdict(nextVerdict);
        onVerdictUpdated(nextVerdict);
        return true;
      }
      return false;
    },
    [onVerdictUpdated, projectId, recheckProgress, te]
  );

  const handleCheckAgain = useCallback(async () => {
    setRecheckError("");
    setRechecking(true);
    setRecheckProgress(8);
    try {
      const response = await fetch(`/api/repositories/${projectId}/scans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanType: "full" }),
      });
      const body = (await response.json().catch(() => null)) as
        | { scan_id?: string; error?: string }
        | null;
      if (!response.ok || !body?.scan_id) {
        throw new Error(body?.error || te("scanStart"));
      }

      const scanId = body.scan_id;
      let done = false;
      for (let i = 0; i < 120 && !done; i += 1) {
        done = await pollUntilVerdict(scanId);
        if (!done) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      if (!done) {
        throw new Error(t("reviewStalledBody"));
      }
    } catch (cause) {
      setRecheckError(cause instanceof Error ? cause.message : te("scanStart"));
    } finally {
      setRechecking(false);
    }
  }, [pollUntilVerdict, projectId, t, te]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="space-y-2 text-center sm:text-left">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
          {t("deployAnswerEyebrow")}
        </p>
        {ready && (
          <p className="text-sm text-emerald-400/90 flex items-center justify-center sm:justify-start gap-2">
            <Sparkles className="h-4 w-4" aria-hidden />
            {t("finaleReadyCelebration")}
          </p>
        )}
      </div>

      <ProductionVerdictHero verdict={verdict} view={view} variant="product" />

      {!ready && topPriority && fixPromptInput && (
        <section className="rounded-3xl border border-primary/25 bg-gradient-to-b from-primary/10 via-[#101014]/80 to-[#101014]/60 p-6 sm:p-8 shadow-[0_0_60px_-24px_rgba(var(--primary-rgb,99,102,241),0.35)]">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary mb-2">
            {t("fixThisFirstTitle")}
          </p>
          <p className="text-lg font-semibold tracking-tight">{topPriority.title}</p>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {topPriority.reason}
          </p>
          {view.estimatedFixMinutes > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("safeFixIntroMinutes", { minutes: view.estimatedFixMinutes })}
            </p>
          )}
          <div className="mt-4 border-t border-border/50 pt-4">
            <SafeFixMetrics input={fixPromptInput} />
          </div>
          <ol className="mt-6 space-y-3 text-sm text-muted-foreground">
            <li>{t("safeFixStepPaste")}</li>
            <li>{t("safeFixStepReturn")}</li>
          </ol>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <CopySafeFixPromptButton
              input={fixPromptInput}
              source="priority"
              priorityId={topPriority.id}
              size="default"
              variant="default"
              className="w-full sm:flex-1 h-12 text-base"
              label={t("copyFixForCursor")}
              copiedLabel={t("copiedFixForCursor")}
            />
          </div>
        </section>
      )}

      {rechecking && (
        <div className="space-y-2 rounded-2xl border border-border/60 bg-secondary/20 p-4">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            {t("finaleRechecking")}
          </div>
          <Progress value={recheckProgress} aria-label={t("finaleRechecking")} />
        </div>
      )}

      {recheckError && (
        <p className="text-sm text-destructive" role="alert">
          {recheckError}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {ready ? (
          <Button className="w-full h-12 text-base" size="lg" onClick={onConnectCursor}>
            {t("connectCursor")}
          </Button>
        ) : (
          <Button
            className="w-full h-12 text-base"
            size="lg"
            onClick={() => void handleCheckAgain()}
            disabled={rechecking}
          >
            {rechecking ? t("finaleRechecking") : t("checkAgain")}
          </Button>
        )}

        {ready ? (
          <Button variant="ghost" className="w-full" onClick={onGoToDashboard}>
            {t("skipCursorGoDashboard")}
          </Button>
        ) : (
          <Button variant="outline" className="w-full" asChild>
            <Link href={`/projects/${projectId}`}>{t("openProjectSecondary")}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
