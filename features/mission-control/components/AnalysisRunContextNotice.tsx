"use client";

import Link from "next/link";
import { useState } from "react";
import { formatStableDateTime } from "@/lib/format/stable-date";
import { useI18n } from "@/lib/i18n/client";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import { useLatestRunProbe } from "../hooks/useLatestRunProbe";
import { deriveRunContext, type RunBrief } from "../lib/run-context";

const shortSha = (sha: string | null) => (sha ? sha.slice(0, 7) : "—");

function RunLabel({ run, t }: { run: RunBrief | null; t: (key: string) => string }) {
  if (!run) return <>{t("analysisRun.contextUnknownRun")}</>;
  const known = ["completed", "running", "failed", "queued", "cancelled"].includes(run.status) ? run.status : "unknown";
  return (
    <>
      <code>{shortSha(run.commitSha)}</code> · {formatStableDateTime(run.createdAt)} · {t(`analysisRun.selector.runStatus.${known}`)}
    </>
  );
}

/** Says which analysis the page shows when it is not the newest, and when a newer one appears while the page sits idle. */
export function AnalysisRunContextNotice({ state }: { state: MissionControlState }) {
  const { t } = useI18n("missionControl");
  // The newest analysis as of the first render: what a page without `run` was showing, and the reference to detect a newer one.
  const [initialLatestRunId] = useState<string | null>(() => state.latestRun?.runId ?? null);
  const probedLatest = useLatestRunProbe(state.projectId);
  const notice = deriveRunContext({ state, initialLatestRunId, probedLatest });
  if (!notice) return null;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm" role="status" data-testid="analysis-run-context" data-kind={notice.kind}>
      <p className="font-medium">
        {notice.kind === "newer_detected" ? t("analysisRun.contextNewerTitle") : t("analysisRun.contextOlderTitle")}
      </p>
      <p className="mt-1 text-muted-foreground">
        {t("analysisRun.contextShowing")} <RunLabel run={notice.selected} t={t} />
      </p>
      <p className="text-muted-foreground">
        {t("analysisRun.contextLatest")} <RunLabel run={notice.latest} t={t} />
      </p>
      <p className="mt-1 text-muted-foreground">{t("analysisRun.contextWarning")}</p>
      <Link className="mt-2 inline-block underline" href={`/projects/${state.projectId}/mission-control`}>
        {t("analysisRun.contextViewLatest")}
      </Link>
    </div>
  );
}
