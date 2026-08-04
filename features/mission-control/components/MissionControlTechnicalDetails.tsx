"use client";

import Link from "next/link";
import { Check, AlertTriangle } from "lucide-react";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { MissionControlView } from "../types";
import { MissionHeader } from "./MissionHeader";
import { ActiveTeams } from "./ActiveTeams";
import { WhyTheseTeams } from "./WhyTheseTeams";
import { MissionFeed } from "./MissionFeed";
import { ProductionVerdictCardSection } from "./ProductionVerdictCard";
import { useI18n } from "@/lib/i18n/client";

function DetailSubsection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

export function MissionControlTechnicalDetails({
  view,
  verdict,
  framework,
  reportHref,
  openByDefault = false,
}: {
  view: MissionControlView;
  verdict: ProductionVerdictV1 | null;
  framework?: string | null;
  reportHref?: string;
  openByDefault?: boolean;
}) {
  const { t } = useI18n("missionControl");
  const { t: tp } = useI18n("projects");

  const areas = verdict
    ? [...(verdict.evaluatedAreas ?? []), ...(verdict.partiallyEvaluatedAreas ?? [])]
    : [];

  return (
    <details className="rounded-2xl border border-border/60 group" open={openByDefault || undefined}>
      <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-muted-foreground list-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <span className="transition-transform group-open:rotate-90">›</span>
          {t("technicalDetails")}
        </span>
      </summary>
      <div className="px-5 pb-8 space-y-10 border-t border-border/40 pt-8">
        <DetailSubsection title={t("technical.repository")}>
          <p className="text-sm font-medium">{view.header.projectName}</p>
        </DetailSubsection>

        {framework ? (
          <DetailSubsection title={t("technical.framework")}>
            <p className="text-sm font-medium capitalize">{framework}</p>
          </DetailSubsection>
        ) : null}

        <DetailSubsection title={t("technical.evidence")}>
          {!view.hideProductionVerdict ? (
            <ProductionVerdictCardSection verdict={view.verdict} />
          ) : null}
          {reportHref ? (
            <Link
              href={reportHref}
              className="inline-block text-sm text-primary underline-offset-4 hover:underline mt-4"
            >
              {tp("technicalDetails")}
            </Link>
          ) : null}
        </DetailSubsection>

        {areas.length > 0 ? (
          <DetailSubsection title={t("technical.architecture")}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {areas.map((area) => {
                const ok = area.status === "evaluated" && (area.score == null || area.score >= 70);
                const partial = area.status === "partial";
                return (
                  <li key={area.key} className="flex items-center gap-2 text-sm">
                    {ok ? (
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" aria-hidden />
                    )}
                    <span className={partial ? "text-muted-foreground" : undefined}>{area.label}</span>
                  </li>
                );
              })}
            </ul>
          </DetailSubsection>
        ) : null}

        <DetailSubsection title={t("technical.attackDetails")}>
          <MissionHeader header={view.header} />
          <ActiveTeams teams={view.teams} />
          <WhyTheseTeams reasons={view.teamReasons} />
        </DetailSubsection>

        {view.feed.length > 0 ? (
          <DetailSubsection title={t("technical.logs")}>
            <MissionFeed items={view.feed} />
          </DetailSubsection>
        ) : null}
      </div>
    </details>
  );
}
