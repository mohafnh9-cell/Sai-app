"use client";

import { useI18n } from "@/lib/i18n/client";
import type { MissionTeamReason } from "../types";

export function WhyTheseTeams({ reasons }: { reasons: MissionTeamReason[] }) {
  const { t } = useI18n("missionControl");

  return (
    <section className="space-y-4" aria-labelledby="why-teams-heading">
      <h2 id="why-teams-heading" className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {t("teams.whyTheseTeams")}
      </h2>
      <ul className="space-y-3">
        {reasons.map((item) => (
          <li
            key={item.teamId}
            className="rounded-2xl border border-border/50 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
          >
            <div>
              <p className="font-medium text-sm">{item.teamName}</p>
              <p className="text-sm text-muted-foreground mt-1">{item.reason}</p>
            </div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">
              {t("teams.confidence", { level: item.confidence })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
