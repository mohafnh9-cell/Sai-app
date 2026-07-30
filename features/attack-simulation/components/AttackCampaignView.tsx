"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { AttackCenterCampaignView } from "../types";
import {
  deriveLiveTestDisplay,
  executionStatusLabel,
  friendlyScenarioTitle,
} from "@/features/security-testing/lib/live-test-copy";

export function AttackCampaignView({
  view,
  onOpenFinding,
  onSelectExecution,
}: {
  view: AttackCenterCampaignView;
  onOpenFinding: (findingId: string) => void;
  onSelectExecution: (executionId: string, findingId?: string | null) => void;
}) {
  const { executions, feed } = view;
  const display = deriveLiveTestDisplay(view);

  return (
    <div className="space-y-8">
      <section className="surface-premium rounded-3xl p-8 sm:p-10 space-y-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Security test</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{display.headline}</h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl">{display.description}</p>
        </div>

        {display.primaryAction ? (
          <Button
            type="button"
            size="lg"
            className="w-full sm:w-auto text-base px-8"
            onClick={() => onOpenFinding(display.primaryAction!.findingId)}
          >
            <ShieldAlert className="mr-2 h-5 w-5" />
            {display.primaryAction.label}
          </Button>
        ) : null}

        <div className="rounded-2xl border border-border/60 bg-muted/10 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {display.showSpinner ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : null}
              <span>{display.statusLabel}</span>
            </div>
            <span className="text-muted-foreground tabular-nums">
              {display.testsDone} of {display.testsTotal} tests done
            </span>
          </div>
          <div className="space-y-2">
            <Progress value={display.progressPercent} className="h-2" />
            <p className="text-xs text-muted-foreground tabular-nums">{display.progressPercent}% complete</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Your tests</h2>
        <ul className="space-y-3">
          {executions.map((execution) => {
            const title = friendlyScenarioTitle(execution.adapterId, execution.scenarioTitle);
            const statusLabel = executionStatusLabel(execution.status);
            const isActionable =
              execution.status === "fix_ready" ||
              execution.status === "confirmed" ||
              Boolean(execution.findingId);

            return (
              <li key={execution.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (execution.findingId) {
                      onOpenFinding(execution.findingId);
                      return;
                    }
                    onSelectExecution(execution.id, execution.findingId);
                  }}
                  className="w-full text-left rounded-2xl border border-border/60 px-5 py-4 hover:bg-accent/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-base leading-snug">{title}</p>
                      {execution.status === "executing" && execution.currentStepTitle ? (
                        <p className="text-sm text-muted-foreground mt-1">{execution.currentStepTitle}</p>
                      ) : null}
                    </div>
                    <span
                      className={
                        isActionable
                          ? "shrink-0 rounded-full bg-primary/15 text-primary px-3 py-1 text-xs font-medium"
                          : "shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                      }
                    >
                      {statusLabel}
                    </span>
                  </div>
                  {!TERMINAL.has(execution.status) ? (
                    <div className="mt-4">
                      <Progress value={execution.progressPercent} className="h-1.5" />
                    </div>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {feed.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">What happened</h2>
          <ul className="space-y-2 max-h-48 overflow-y-auto rounded-xl border border-border/40 px-4 py-2">
            {feed.slice(0, 8).map((item) => (
              <li key={item.id} className="text-sm py-2 border-b border-border/30 last:border-0">
                {humanFeedLabel(item.label)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

const TERMINAL = new Set([
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "not_exploitable",
  "protected",
  "still_vulnerable",
  "fix_ready",
  "confirmed",
]);

function humanFeedLabel(label: string): string {
  const map: Record<string, string> = {
    "Attack scenarios planned": "We picked the tests to run",
    "Attack execution started": "A test started",
    "Evidence collected": "We saved proof of what happened",
    "Vulnerability confirmed": "We found a real problem",
    "Attack not exploitable": "This attack did not work",
    "Attack blocked by Safe Runtime": "Your app blocked the attack",
    "Safe Fix ready": "A fix is ready for you",
    "Protection verified": "Your fix worked",
    "Application still vulnerable": "The problem is still there",
    "Attack failed": "This test could not finish",
    "Attack cancelled": "This test was stopped",
  };
  if (map[label]) return map[label];
  if (label.startsWith("Step started:")) return `Now: ${label.replace("Step started: ", "")}`;
  if (label.startsWith("Step completed:")) return `Done: ${label.replace("Step completed: ", "")}`;
  return label;
}
