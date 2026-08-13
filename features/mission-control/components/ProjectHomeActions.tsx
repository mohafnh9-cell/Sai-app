"use client";

import { Loader2, ScanSearch, Shield, Sparkles } from "lucide-react";
import { GitHubReauthBanner } from "@/features/github/components/GitHubReauthBanner";
import { ScanPaywallBanner } from "@/features/billing/components/ScanPaywallBanner";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import { useI18n } from "@/lib/i18n/client";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import { formatPriorityTitleForLocale } from "@/lib/i18n/priority-display";
import { Button } from "@/components/ui/button";
import { shouldShowScore } from "@/brain/production-verdict/status-ui";

function ActionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-border/60 bg-card/40 p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="space-y-1 min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      {children}
    </article>
  );
}

const SCAN_LABEL_KEYS = {
  cta: "projectHome.scanCode.cta",
  running: "projectHome.scanCode.running",
  rescan: "projectHome.scanCode.rescan",
  retry: "projectHome.scanCode.retry",
} as const;

const SECURITY_LABEL_KEYS = {
  cta: "projectHome.testSecurity.cta",
  running: "projectHome.testSecurity.running",
} as const;

export function ProjectHomeActions({
  state,
  scanAction,
  securityAction,
  actionError,
  reauthRequired,
  subscriptionRequired,
  onStartScan,
  onStartSecurityTest,
}: {
  state: MissionControlState;
  scanAction: MissionControlState["actions"]["scan"] & { label: MissionControlState["actions"]["scan"]["label"] };
  securityAction: MissionControlState["actions"]["security"] & { label: MissionControlState["actions"]["security"]["label"] };
  actionError: string | null;
  reauthRequired?: boolean;
  subscriptionRequired?: boolean;
  onStartScan: () => void;
  onStartSecurityTest: () => void;
}) {
  const { t, locale } = useI18n("missionControl");
  const { t: tc } = useI18n("common");
  const verdict = state.productionVerdict;

  const relativeLabels = {
    never: tc("never"),
    justNow: tc("justNow"),
    minutesAgo: tc("minutesAgo"),
    hoursAgo: tc("hoursAgo"),
    daysAgo: tc("daysAgo"),
  };

  const lastAnalysisLabel = state.status.lastAnalysisAt
    ? formatRelativeLocalized(locale, state.status.lastAnalysisAt, relativeLabels)
    : t("projectHome.lastAnalysisNever");

  const topBlocker = verdict?.topPriorities?.[0] ?? null;
  const showScore = verdict ? shouldShowScore(verdict.score, verdict.status) : false;

  return (
    <section className="space-y-6 mb-10" aria-labelledby="project-home-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p id="project-home-heading" className="text-muted-foreground">
          {state.status.repositoryConnected
            ? t("projectHome.repositoryConnected")
            : t("projectHome.repositoryNotConnected")}
        </p>
        <p className="text-muted-foreground">
          {t("projectHome.lastAnalysis")}:{" "}
          <span className="text-foreground font-medium">{lastAnalysisLabel}</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ActionCard
          icon={<ScanSearch className="h-5 w-5" aria-hidden />}
          title={t("projectHome.scanCode.title")}
          description={t("projectHome.scanCode.description")}
        >
          <div className="w-full [&_button]:w-full [&_button]:h-11 [&_button]:rounded-full">
            <Button
              type="button"
              className="w-full h-11 rounded-full"
              disabled={scanAction.disabled}
              aria-busy={scanAction.showSpinner}
              variant={scanAction.label === "retry" ? "destructive" : "default"}
              onClick={onStartScan}
            >
              {scanAction.showSpinner ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {t(SCAN_LABEL_KEYS[scanAction.label])}
            </Button>
            {state.status.reviewInProgress && state.status.progressMessage ? (
              <p className="mt-2 text-xs text-muted-foreground" role="status">
                {state.status.progressMessage}
              </p>
            ) : state.status.reviewInProgress && state.status.progress != null ? (
              <p className="mt-2 text-xs text-muted-foreground" role="status">
                {state.status.progress}%
              </p>
            ) : null}
          </div>
        </ActionCard>

        {state.flags.attackCenterEnabled ? (
          <ActionCard
            icon={<Shield className="h-5 w-5" aria-hidden />}
            title={t("projectHome.testSecurity.title")}
            description={t("projectHome.testSecurity.description")}
          >
            <Button
              type="button"
              className="w-full h-11 rounded-full"
              variant="secondary"
              disabled={securityAction.disabled}
              aria-busy={securityAction.showSpinner}
              onClick={onStartSecurityTest}
            >
              {securityAction.showSpinner ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {t(SECURITY_LABEL_KEYS[securityAction.label])}
            </Button>
          </ActionCard>
        ) : null}
      </div>

      {subscriptionRequired ? (
        <ScanPaywallBanner
          message={actionError ?? undefined}
          returnPath={`/projects/${state.projectId}/mission-control`}
        />
      ) : null}

      {reauthRequired ? (
        <GitHubReauthBanner
          returnPath={`/projects/${state.projectId}/mission-control`}
          message={actionError ?? undefined}
        />
      ) : actionError && !reauthRequired && !subscriptionRequired ? (
        <p className="text-xs text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      {verdict ? (
        <article
          id="production-verdict"
          className="rounded-2xl border border-border/60 bg-[#101014]/50 p-6 sm:p-8 space-y-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {t("projectHome.verdictSummary.title")}
              </p>
              <div className="flex items-end gap-4">
                {showScore && verdict.score != null ? (
                  <p className="text-5xl font-semibold tabular-nums tracking-tight leading-none">
                    {verdict.score}
                  </p>
                ) : null}
                <VerdictStatusBadge status={verdict.status} />
              </div>
              {showScore ? (
                <p className="text-xs text-muted-foreground">{t("projectHome.verdictSummary.score")}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">
              {t("projectHome.verdictSummary.mainBlocker")}
            </p>
            <p className="text-base font-medium leading-snug">
              {topBlocker
                ? formatPriorityTitleForLocale(topBlocker, locale)
                : t("projectHome.verdictSummary.noBlocker")}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline" className="rounded-full">
              <a href="#production-verdict-detail">{t("projectHome.verdictSummary.viewVerdict")}</a>
            </Button>
          </div>
        </article>
      ) : null}

      {verdict && topBlocker && verdict.status !== "ready_to_ship" ? (
        <ActionCard
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
          title={t("projectHome.aiFix.title")}
          description={t("projectHome.aiFix.description")}
        >
          <Button asChild className="w-full h-11 rounded-full sm:w-auto sm:min-w-[220px]">
            <a href="#production-verdict-detail">{t("projectHome.aiFix.cta")}</a>
          </Button>
        </ActionCard>
      ) : null}
    </section>
  );
}
