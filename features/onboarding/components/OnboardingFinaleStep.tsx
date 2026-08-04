"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { fixPromptInputFromPriority } from "@/brain/fix-prompt";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MissionControlHero } from "@/features/mission-control/components/MissionControlHero";
import { SafeFixHeroCard } from "@/features/production-verdict/components/SafeFixHeroCard";
import { scanIsCompleted } from "../onboarding-flow";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";
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
  const [recheckVerdict, setRecheckVerdict] = useState<ProductionVerdictV1 | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [recheckProgress, setRecheckProgress] = useState(12);
  const [recheckError, setRecheckError] = useState("");

  const verdict = recheckVerdict ?? initialVerdict;
  const ready = verdict.status === "ready_to_ship";
  const topPriority = verdict.topPriorities[0] ?? null;

  const fixPromptInput = useMemo(() => {
    if (!topPriority || ready) return null;
    return fixPromptInputFromPriority(topPriority, {
      projectName,
      currentVerdictStatus: verdict.status,
      currentScore: verdict.score,
    });
  }, [topPriority, projectName, ready, verdict.score, verdict.status]);

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
        setRecheckVerdict(nextVerdict);
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
      {ready && (
        <p className="text-sm text-emerald-400/90 flex items-center justify-center sm:justify-start gap-2">
          <Sparkles className="h-4 w-4" aria-hidden />
          {t("finaleReadyCelebration")}
        </p>
      )}

      <MissionControlHero verdict={verdict} />

      {!ready && topPriority && fixPromptInput && (
        <SafeFixHeroCard
          topPriority={topPriority}
          fixPromptInput={fixPromptInput}
          labels={{
            eyebrow: t("fixThisFirstTitle"),
            stepOne: t("safeFixStepPaste"),
            stepTwo: t("safeFixStepReturn"),
            copyLabel: t("copyFixForCursor"),
            copiedLabel: t("copiedFixForCursor"),
          }}
        />
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
          <>
            <Button className="w-full h-12 text-base" size="lg" onClick={onGoToDashboard}>
              {t("goToDashboard")}
            </Button>
            <Button variant="outline" className="w-full" onClick={onConnectCursor}>
              {t("connectCursor")}
            </Button>
          </>
        ) : (
          <>
            <Button
              className="w-full h-12 text-base"
              size="lg"
              onClick={() => void handleCheckAgain()}
              disabled={rechecking}
            >
              {rechecking ? t("finaleRechecking") : t("checkAgain")}
            </Button>
            <Button variant="ghost" className="w-full" asChild>
              <Link href={projectVerdictHref(projectId)}>{t("openProjectSecondary")}</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
