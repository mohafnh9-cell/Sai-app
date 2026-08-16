"use client";

import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import type { ScanFinding } from "@/features/security-scanner/components/types";
import type { MissionControlView } from "../types";
import { MissionHeader } from "./MissionHeader";
import { ActiveTeams } from "./ActiveTeams";
import { WhyTheseTeams } from "./WhyTheseTeams";
import { MissionFeed } from "./MissionFeed";
import { ProductionVerdictCardSection } from "./ProductionVerdictCard";
import { CoverageBreakdown } from "@/features/production-verdict/components/CoverageBreakdown";
import { TechnicalFindingsSection } from "@/features/production-verdict/components/TechnicalFindingsSection";
import { FastestPathForward } from "@/features/production-verdict/components/FastestPathForward";
import { LocalGitHubCorrelationPanel } from "@/features/local-github-correlation/components/LocalGitHubCorrelationPanel";
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
  findings,
  fixPromptContext,
  projectId,
  openByDefault = false,
}: {
  view: MissionControlView;
  verdict: ProductionVerdictV1 | null;
  framework?: string | null;
  findings?: ScanFinding[];
  fixPromptContext?: FixPromptContext;
  projectId?: string;
  openByDefault?: boolean;
}) {
  const { t } = useI18n("missionControl");

  return (
    <details className="rounded-2xl border border-border/60 group" open={openByDefault || undefined}>
      <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-muted-foreground list-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <span className="transition-transform group-open:rotate-90">›</span>
          {t("fullReport.title")}
        </span>
        <p className="mt-1 text-xs font-normal text-muted-foreground/80">{t("fullReport.subtitle")}</p>
      </summary>
      <div className="px-5 pb-8 space-y-10 border-t border-border/40 pt-8">
        {verdict?.executiveSummary ? (
          <DetailSubsection title={t("fullReport.summary")}>
            <p className="text-sm leading-relaxed text-foreground/90">{verdict.executiveSummary}</p>
            {verdict.methodologyNote ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{verdict.methodologyNote}</p>
            ) : null}
          </DetailSubsection>
        ) : null}

        {verdict ? <CoverageBreakdown verdict={verdict} /> : null}

        {verdict && verdict.topPriorities.length > 0 ? (
          <FastestPathForward
            priorities={verdict.topPriorities}
            fixPromptContext={fixPromptContext}
            titleKey={
              verdict.status === "ready_to_ship" ? "fastestPathTitle" : "criticalBlockersTitle"
            }
            subtitleKey={
              verdict.status === "ready_to_ship"
                ? "fastestPathSubtitle"
                : "criticalBlockersSubtitle"
            }
          />
        ) : null}

        {findings && findings.length > 0 ? (
          <TechnicalFindingsSection findings={findings} fixPromptContext={fixPromptContext} />
        ) : verdict ? (
          <DetailSubsection title={t("fullReport.findings")}>
            <p className="text-sm text-muted-foreground">{t("fullReport.noFindings")}</p>
          </DetailSubsection>
        ) : null}

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
        </DetailSubsection>

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

        {projectId ? (
          <details className="rounded-xl border border-border/50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground">
              {t("localCorrelation.title")}
            </summary>
            <div className="px-4 pb-4">
              <LocalGitHubCorrelationPanel projectId={projectId} />
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}
