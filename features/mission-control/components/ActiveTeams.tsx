"use client";

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/client";
import type { MissionTeamCard } from "../types";

export function ActiveTeams({ teams }: { teams: MissionTeamCard[] }) {
  const { t } = useI18n("missionControl");

  const statusLabel = (status: MissionTeamCard["status"]) => t(`status.${status}`);

  return (
    <section className="space-y-4" aria-labelledby="active-teams-heading">
      <h2 id="active-teams-heading" className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {t("teams.activeTeams")}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {teams.map((team) => (
          <div
            key={team.id}
            className="rounded-2xl border border-border/60 bg-[#101014]/40 px-5 py-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm">{team.name}</p>
              <Badge variant={team.status === "running" ? "default" : "secondary"} className="text-[10px]">
                {statusLabel(team.status)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{team.estimatedDurationLabel}</p>
            {team.status !== "skipped" && team.status !== "failed" && (
              <Progress value={team.progressPercent} className="h-1" />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
