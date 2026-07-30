"use client";

import { Progress } from "@/components/ui/progress";
import type { AttackCenterCampaignView } from "../types";

function formatEta(ms: number | null): string {
  if (ms == null) return "—";
  if (ms <= 0) return "Complete";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}

export function AttackCampaignView({
  view,
  onSelectExecution,
}: {
  view: AttackCenterCampaignView;
  onSelectExecution: (executionId: string) => void;
}) {
  const { campaign, executions, feed } = view;

  return (
    <div className="space-y-10">
      <section className="surface-premium rounded-3xl p-8 sm:p-10 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Security test</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2">Live test</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider">Status</p>
            <p className="mt-1 font-medium capitalize">{campaign.status.replaceAll("_", " ")}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider">Commit</p>
            <p className="mt-1 font-medium font-mono">{campaign.commitSha.slice(0, 7)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider">Runtime</p>
            <p className="mt-1 font-medium capitalize">{campaign.runtimeMode.replaceAll("_", " ")}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider">ETA</p>
            <p className="mt-1 font-medium tabular-nums">{formatEta(campaign.estimatedRemainingMs)}</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="tabular-nums">{campaign.progressPercent}%</span>
          </div>
          <Progress value={campaign.progressPercent} className="h-1.5" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          <div className="rounded-xl border border-border/60 px-4 py-3">
            <p className="text-muted-foreground text-xs">Executions</p>
            <p className="mt-1 font-semibold tabular-nums">
              {campaign.completedExecutions}/{campaign.totalExecutions}
            </p>
          </div>
          <div className="rounded-xl border border-border/60 px-4 py-3">
            <p className="text-muted-foreground text-xs">Confirmed</p>
            <p className="mt-1 font-semibold tabular-nums">{campaign.confirmedFindings}</p>
          </div>
          <div className="rounded-xl border border-border/60 px-4 py-3">
            <p className="text-muted-foreground text-xs">Blocked</p>
            <p className="mt-1 font-semibold tabular-nums">{campaign.blockedExecutions}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Tests running
        </h2>
        <ul className="space-y-2">
          {executions.map((execution) => (
            <li key={execution.id}>
              <button
                type="button"
                onClick={() => onSelectExecution(execution.id)}
                className="w-full text-left rounded-xl border border-border/60 px-4 py-3 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{execution.scenarioTitle}</p>
                    <p className="text-xs text-muted-foreground mt-1">{execution.adapterId}</p>
                  </div>
                  <span className="text-xs capitalize text-muted-foreground">
                    {execution.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="mt-3">
                  <Progress value={execution.progressPercent} className="h-1" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          What is happening now
        </h2>
        <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {feed.map((item) => (
            <li key={item.id} className="text-sm py-2 border-b border-border/40 last:border-0">
              {item.label}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
