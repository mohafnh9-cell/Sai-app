"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { AttackCenterCampaignView } from "../types";
import {
  deriveLiveTestDisplay,
  deriveLiveTestPhase,
  executionStatusLabel,
  friendlyScenarioTitle,
  humanFeedLabel,
} from "@/features/security-testing/lib/live-test-copy";
import { TERMINAL_DISPLAY_PHASES } from "@/features/security-testing/lib/derive-phase";
import { PrimaryActionButton } from "@/features/security-testing/components/SecurityTestHero";

function isIssueStatus(status: string): boolean {
  return status === "fix_ready" || status === "confirmed" || status === "still_vulnerable";
}

export function AttackCampaignView({
  view,
  onOpenFinding,
}: {
  view: AttackCenterCampaignView;
  onOpenFinding: (findingId: string) => void;
}) {
  const router = useRouter();
  const { t: ts } = useI18n("securityTest");
  const { t: ta } = useI18n("attackCenter");
  const phase = deriveLiveTestPhase(view);
  const isRunning = phase === "running" || phase === "preparing";
  const showResultsReport = !isRunning;
  const [showDetails, setShowDetails] = useState(() => isRunning);
  const { executions, feed } = view;
  const display = deriveLiveTestDisplay(view, ts);
  const hasPrimaryAction = Boolean(display.primaryAction) && !showResultsReport;

  const headline = showResultsReport ? ta("campaign.resultsHeadline") : display.headline;
  const description = showResultsReport ? ta("campaign.resultsDescription") : display.description;

  const issueCount = useMemo(
    () => executions.filter((execution) => isIssueStatus(execution.status)).length,
    [executions]
  );

  const handlePrimary = () => {
    if (!display.primaryAction) return;
    if (display.primaryAction.findingId) {
      onOpenFinding(display.primaryAction.findingId);
      return;
    }
    if (display.primaryAction.href) {
      router.push(display.primaryAction.href);
    }
  };

  return (
    <div className="space-y-6">
      <section className="surface-premium rounded-3xl p-8 sm:p-10 space-y-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{ta("campaign.title")}</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{headline}</h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl">{description}</p>
        </div>

        {display.waitMessage ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
            <span>{display.waitMessage}</span>
          </div>
        ) : null}

        {hasPrimaryAction ? (
          <PrimaryActionButton onClick={handlePrimary}>
            {display.primaryAction!.label}
          </PrimaryActionButton>
        ) : null}

        <div className="rounded-2xl border border-border/60 bg-muted/10 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {display.showSpinner ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : null}
              {!display.showSpinner && TERMINAL_DISPLAY_PHASES.has(phase) ? (
                <ShieldCheck className="h-4 w-4 text-primary" />
              ) : null}
              <span>{display.statusLabel}</span>
            </div>
            <span className="text-muted-foreground tabular-nums">
              {ta("campaign.checksDone", { done: display.testsDone, total: display.testsTotal })}
            </span>
          </div>
          <div className="space-y-2">
            <Progress value={display.progressPercent} className="h-2" />
          </div>
        </div>
      </section>

      {showResultsReport && executions.length > 0 ? (
        <section className="rounded-2xl border border-border/60 bg-card p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{ta("campaign.resultsTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {issueCount > 0
                ? ta("campaign.resultsIssuesFound", { count: issueCount })
                : ta("campaign.resultsNoIssues")}
            </p>
          </div>
          <ul className="space-y-3">
            {executions.map((execution) => {
              const title = friendlyScenarioTitle(execution.adapterId, execution.scenarioTitle, ts);
              const statusLabel = executionStatusLabel(execution.status, ts);
              const hasReport = Boolean(execution.findingId);
              const issue = isIssueStatus(execution.status);

              return (
                <li
                  key={execution.id}
                  className={cn(
                    "rounded-xl border px-4 py-4 text-sm",
                    issue ? "border-red-500/30 bg-red-500/5" : "border-border/40 bg-muted/10"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium leading-snug">{title}</p>
                      <p className="text-xs text-muted-foreground">{statusLabel}</p>
                    </div>
                    {hasReport ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={issue ? "default" : "outline"}
                        className="shrink-0 gap-1"
                        onClick={() => onOpenFinding(execution.findingId!)}
                      >
                        {ta("campaign.viewReport")}
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {issueCount > 0 ? (
            <p className="text-xs text-muted-foreground">{ta("campaign.resultsHint")}</p>
          ) : (
            <PrimaryActionButton onClick={() => router.push(`/projects/${view.projectId}/mission-control`)}>
              {ta("deployWithConfidence")}
            </PrimaryActionButton>
          )}
        </section>
      ) : null}

      {executions.length > 0 ? (
        <details
          className="group rounded-2xl border border-border/60"
          open={showDetails}
          onToggle={(event) => setShowDetails((event.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium list-none flex items-center justify-between">
            <span>{ta("campaign.testDetails")}</span>
            <span className="text-muted-foreground text-xs group-open:hidden">{ta("campaign.show")}</span>
            <span className="text-muted-foreground text-xs hidden group-open:inline">{ta("campaign.hide")}</span>
          </summary>
          <ul className="space-y-2 px-5 pb-5 border-t border-border/40 pt-4">
            {executions.map((execution) => {
              const title = friendlyScenarioTitle(execution.adapterId, execution.scenarioTitle, ts);
              const statusLabel = executionStatusLabel(execution.status, ts);
              return (
                <li
                  key={execution.id}
                  className="rounded-xl border border-border/40 px-4 py-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium leading-snug">{title}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{statusLabel}</span>
                  </div>
                  {execution.status === "executing" && execution.currentStepTitle ? (
                    <p className="text-xs text-muted-foreground mt-1">{execution.currentStepTitle}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      {feed.length > 0 ? (
        <details className="rounded-2xl border border-border/60">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-muted-foreground">
            {ta("campaign.technicalDetails")}
          </summary>
          <ul className="space-y-2 px-5 pb-5 border-t border-border/40 pt-4 max-h-48 overflow-y-auto">
            {feed.slice(0, 12).map((item) => (
              <li key={item.id} className="text-xs text-muted-foreground py-1.5 border-b border-border/20 last:border-0">
                {humanFeedLabel(item.label, ts)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
