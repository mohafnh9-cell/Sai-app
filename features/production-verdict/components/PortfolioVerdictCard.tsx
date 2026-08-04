"use client";

import Link from "next/link";
import { FolderGit2, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { verdictBadgeVariant } from "@/brain/production-verdict/status-ui";
import type { ProjectBrainSummary } from "@/brain";
import { useI18n } from "@/lib/i18n/client";
import { verdictStatusLabel, verdictStatusMessage } from "@/lib/i18n/verdict-copy";
import { useDemoNavigation } from "@/features/demo/use-demo-navigation";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

export function PortfolioVerdictCard({
  projectId,
  projectName,
  summary,
}: {
  projectId: string;
  projectName: string;
  summary: ProjectBrainSummary | undefined;
}) {
  const { t } = useI18n();
  const { t: td } = useI18n("dashboard");
  const { href } = useDemoNavigation();
  const projectHref = href(projectVerdictHref(projectId));
  const status = summary?.status ?? "insufficient_data";
  const translate = (key: string, params?: Record<string, string | number | null | undefined>) =>
    t(key, params);
  const statusLabel = verdictStatusLabel(status, translate);
  const statusLine = verdictStatusMessage(status, translate);

  return (
    <Link
      href={projectHref}
      aria-label={td("portfolioOpenProject", { name: projectName, status: statusLabel })}
      className="group flex items-center justify-between gap-4 rounded-2xl border border-border/50 bg-card/40 px-4 py-4 transition-all duration-200 hover:border-border hover:bg-card/70 hover:shadow-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/80">
          <FolderGit2 className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{projectName}</p>
          <div className="mt-1.5">
            <Badge variant={verdictBadgeVariant(status)} className="text-[10px] uppercase tracking-wide">
              {statusLabel}
            </Badge>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{statusLine}</p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
    </Link>
  );
}
