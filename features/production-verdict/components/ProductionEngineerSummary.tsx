"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2 } from "lucide-react";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { useI18n } from "@/lib/i18n/client";

type Intelligence = {
  report?: {
    status?: string;
    executive_summary?: string;
    coach_tip?: string;
  } | null;
  coachTip?: string | null;
};

export function ProductionEngineerSummary({
  scanId,
  verdict,
  scanCompleted,
}: {
  scanId: string;
  verdict: ProductionVerdictV1;
  scanCompleted: boolean;
}) {
  const { t } = useI18n("verdict");
  const [loading, setLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [coachTip, setCoachTip] = useState<string | null>(null);
  const [aiFailed, setAiFailed] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/scans/${scanId}/ai-analysis`, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as
      | { intelligence?: Intelligence | null }
      | null;
    if (!response.ok) {
      setAiFailed(true);
      return;
    }
    const report = body?.intelligence?.report;
    if (report?.status === "completed") {
      setAiSummary(report.executive_summary ?? null);
      setCoachTip(body?.intelligence?.coachTip ?? report.coach_tip ?? null);
    }
  }, [scanId]);

  useEffect(() => {
    if (!scanCompleted) return;
    queueMicrotask(() => void load());
  }, [load, scanCompleted]);

  const runReview = async () => {
    setLoading(true);
    setAiFailed(false);
    try {
      const response = await fetch(`/api/scans/${scanId}/ai-analysis`, { method: "POST" });
      if (!response.ok) {
        setAiFailed(true);
        return;
      }
      await load();
    } finally {
      setLoading(false);
    }
  };

  if (!scanCompleted) return null;

  const summary = aiSummary ?? verdict.executiveSummary;
  const nextAction = coachTip ?? verdict.recommendedAction;
  const commitLine = verdict.commitSha
    ? t("commitReviewed", { sha: verdict.commitSha.slice(0, 12) })
    : t("latestChanges");

  return (
    <section
      className="rounded-xl border border-primary/20 bg-surface p-6"
      aria-labelledby="ai-engineer-heading"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="ai-engineer-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <Brain className="h-4 w-4 text-primary" aria-hidden />
            {t("aiEngineerTitle")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">{t("aiEngineerSubtitle")}</p>
        </div>
        {!aiSummary && (
          <button
            type="button"
            onClick={() => void runReview()}
            disabled={loading}
            className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            {loading ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> {t("generating")}
              </span>
            ) : (
              t("enhanceSummary")
            )}
          </button>
        )}
      </div>

      <div className="mt-4 space-y-4 text-sm leading-relaxed">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            {t("reviewSummary")}
          </p>
          <p>{commitLine}</p>
          <p className="mt-2">{summary}</p>
        </div>

        {verdict.estimatedFixMinutes > 0 && verdict.status !== "ready_to_ship" && (
          <p className="text-muted-foreground">
            {t("estimatedImplementation", { minutes: verdict.estimatedFixMinutes })}
          </p>
        )}

        <div className="border-t border-border/50 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
            {t("recommendedNextAction")}
          </p>
          <p>{nextAction}</p>
        </div>

        {aiFailed && (
          <p className="text-xs text-muted-foreground">{t("aiUnavailableDeterministic")}</p>
        )}
      </div>
    </section>
  );
}
