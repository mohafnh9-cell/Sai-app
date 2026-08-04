"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import type { AnalysisRunListItem } from "@/server/analysis-runs/list-analysis-runs";
import { useAnalysisRuns } from "../hooks/useAnalysisRuns";

function shortSha(sha: string | null): string {
  if (!sha) return "—";
  return sha.slice(0, 7);
}

function formatRunLabel(
  run: AnalysisRunListItem,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  const score =
    run.securityScore != null ? `${run.securityScore}/100` : t("analysisRun.selector.noScore");
  const statusKey = run.verdictStatus ?? run.status;
  return t("analysisRun.selector.runOption", {
    sha: shortSha(run.commitSha),
    score,
    status: statusKey,
  });
}

export function AnalysisRunSelector({
  runs: initialRuns,
  activeRunId,
}: {
  runs: AnalysisRunListItem[];
  activeRunId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useI18n("missionControl");
  const projectId = pathname.match(/\/projects\/([^/]+)/)?.[1] ?? "";
  const { data: runs = initialRuns } = useAnalysisRuns(projectId, {
    initialRuns,
    enabled: Boolean(projectId),
  });

  const onChange = useCallback(
    (runId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (runId) {
        params.set("run", runId);
      } else {
        params.delete("run");
      }
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    },
    [pathname, router, searchParams]
  );

  if (runs.length <= 1) return null;

  return (
    <div className="mb-8 rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 sm:px-5">
      <label htmlFor="analysis-run-select" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("analysisRun.selector.label")}
      </label>
      <select
        id="analysis-run-select"
        className="mt-2 w-full rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm"
        value={activeRunId ?? runs[0]?.runId ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        {runs.map((run) => (
          <option key={run.runId} value={run.runId}>
            {formatRunLabel(run, t)}
          </option>
        ))}
      </select>
      {activeRunId ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("analysisRun.selector.hint")}
        </p>
      ) : null}
    </div>
  );
}
