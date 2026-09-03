"use client";

import { Loader2, ScanSearch, Swords } from "lucide-react";
import { GitHubReauthBanner } from "@/features/github/components/GitHubReauthBanner";
import { ScanPaywallBanner } from "@/features/billing/components/ScanPaywallBanner";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import { useI18n } from "@/lib/i18n/client";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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
    <div className="flex-1 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      {children}
    </div>
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

  /** Real signal: an existing verdict still has open blockers, so this is a "did the fix work?" rescan, not a first scan. */
  const isVerifyRescan =
    scanAction.label === "rescan" && (state.productionVerdict?.topPriorities?.length ?? 0) > 0;

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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <ActionCard
          icon={<ScanSearch className="h-5 w-5" aria-hidden />}
          title={t("projectHome.scanCode.title")}
          description={
            isVerifyRescan
              ? t("projectHome.scanCode.verifyDescription")
              : t("projectHome.scanCode.description")
          }
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
          <>
            <Separator orientation="vertical" className="hidden h-auto sm:block" />
            <Separator className="sm:hidden" />
            <ActionCard
              icon={<Swords className="h-5 w-5" aria-hidden />}
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
          </>
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

    </section>
  );
}
