"use client";

import Link from "next/link";
import { ChevronRight, FolderGit2 } from "lucide-react";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { verdictSurfaceClass } from "@/lib/design-system/verdict";
import type { ProjectBrainSummary } from "@/brain";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { useI18n } from "@/lib/i18n/client";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import { verdictStatusMessage } from "@/lib/i18n/verdict-copy";
import { cn } from "@/lib/utils";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

type PortfolioProjectRowProps = {
  projectId: string;
  projectName: string;
  githubRepo?: string | null;
  summary?: ProjectBrainSummary;
  verdictStatus?: VerdictStatus;
  lastScanAt?: string | null;
  href?: string;
  needsAttention?: boolean;
  className?: string;
};

export function PortfolioProjectRow({
  projectId,
  projectName,
  githubRepo,
  summary,
  verdictStatus,
  lastScanAt,
  href,
  needsAttention = false,
  className,
}: PortfolioProjectRowProps) {
  const { t, locale } = useI18n();
  const { t: tc } = useI18n("common");
  const { t: tp } = useI18n("projects");
  const translate = (key: string, params?: Record<string, string | number | null | undefined>) =>
    t(key, params);

  const status = summary?.status ?? verdictStatus ?? "insufficient_data";
  const score = summary?.productionReady ?? null;
  const blockers = summary?.blockersCount ?? 0;
  const targetHref = href ?? projectVerdictHref(projectId);
  const tone = needsAttention ? verdictSurfaceClass(status) : "";

  const lastAnalyzed = lastScanAt ?? summary?.generatedAt ?? null;
  const lastLabel = lastAnalyzed
    ? formatRelativeLocalized(locale, lastAnalyzed, {
        never: tc("never"),
        justNow: tc("justNow"),
        minutesAgo: tc("minutesAgo"),
        hoursAgo: tc("hoursAgo"),
        daysAgo: tc("daysAgo"),
      })
    : tc("never");

  return (
    <Link
      href={targetHref}
      className={cn(
        "group flex items-stretch gap-0 rounded-xl border border-border/50 bg-transparent seq-transition hover:bg-surface-hover seq-focus-ring overflow-hidden",
        tone,
        className
      )}
      aria-label={tp("openProjectAria", { name: projectName })}
    >
      {needsAttention ? (
        <span className="w-0.5 shrink-0 bg-primary/60" aria-hidden />
      ) : null}
      <div className="flex flex-1 items-center justify-between gap-4 px-4 py-4 min-w-0">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40 mt-0.5">
            <FolderGit2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="truncate text-sm font-semibold">{projectName}</p>
              {githubRepo ? (
                <p className="truncate text-xs text-muted-foreground font-mono mt-0.5">{githubRepo}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <VerdictStatusBadge status={status} />
              {blockers > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {tp("blockersCount", { count: blockers })}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-1">
              {verdictStatusMessage(status, translate)}
            </p>
          </div>
        </div>

        <div className="hidden sm:flex flex-col items-end gap-2 shrink-0 text-right">
          {score != null ? (
            <p className="text-xl font-semibold tabular-nums leading-none text-muted-foreground">{score}</p>
          ) : null}
          <p className="text-label-caps">{tp("lastAnalyzed")}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{lastLabel}</p>
        </div>

        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground self-center group-hover:text-foreground seq-transition"
          aria-hidden
        />
      </div>
    </Link>
  );
}
