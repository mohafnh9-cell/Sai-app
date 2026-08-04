import Link from "next/link";
import { FolderGit2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n/server";
import { verdictStatusLabel, verdictStatusMessage } from "@/lib/i18n/verdict-copy";
import { verdictBadgeVariant } from "@/brain/production-verdict/status-ui";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { ProjectRow } from "@/types/database";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

interface ProjectCardProps {
  project: ProjectRow;
  verdictStatus?: VerdictStatus;
  detailHref?: string;
}

export async function ProjectCard({
  project,
  verdictStatus = "insufficient_data",
  detailHref,
}: ProjectCardProps) {
  const { t } = await getTranslator("projects");
  const { t: tAll } = await getTranslator();
  const translate = (key: string, params?: Record<string, string | number | null | undefined>) =>
    tAll(key, params);

  const href = detailHref ?? projectVerdictHref(project.id);
  const statusLine = verdictStatusMessage(verdictStatus, translate);

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/50 bg-card/40 px-4 py-4 transition-colors hover:border-border hover:bg-card/60">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <FolderGit2 className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{project.name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge variant={verdictBadgeVariant(verdictStatus)} className="text-[10px] uppercase tracking-wide">
              {verdictStatusLabel(verdictStatus, translate)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{statusLine}</p>
        </div>
      </div>
      <Button size="sm" variant="outline" className="shrink-0 rounded-xl" asChild>
        <Link href={href}>{t("openProject")}</Link>
      </Button>
    </div>
  );
}
