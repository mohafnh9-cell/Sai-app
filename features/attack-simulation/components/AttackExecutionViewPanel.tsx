"use client";

import { Progress } from "@/components/ui/progress";
import type { AttackCenterExecutionView } from "../types";

function formatEta(ms: number | null): string {
  if (ms == null) return "—";
  if (ms <= 0) return "Complete";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}

export function AttackExecutionViewPanel({ view }: { view: AttackCenterExecutionView }) {
  const { execution, steps, feed } = view;

  return (
    <div className="space-y-10">
      <section className="surface-premium rounded-3xl p-8 sm:p-10 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Attack Center</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2">Execution</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider">Status</p>
            <p className="mt-1 font-medium capitalize">{execution.status.replaceAll("_", " ")}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider">Current step</p>
            <p className="mt-1 font-medium">{execution.currentStepTitle ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider">Elapsed</p>
            <p className="mt-1 font-medium tabular-nums">{formatEta(execution.elapsedMs)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wider">ETA</p>
            <p className="mt-1 font-medium tabular-nums">{formatEta(execution.estimatedRemainingMs)}</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="tabular-nums">{execution.progressPercent}%</span>
          </div>
          <Progress value={execution.progressPercent} className="h-1.5" />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Steps</h2>
        <ol className="space-y-2">
          {steps.map((step) => (
            <li
              key={step.id}
              className="rounded-xl border border-border/60 px-4 py-3 flex items-center justify-between gap-3"
            >
              <div>
                <p className="font-medium">{step.label}</p>
                <p className="text-xs text-muted-foreground mt-1 capitalize">{step.kind.replaceAll("_", " ")}</p>
              </div>
              <span className="text-xs capitalize text-muted-foreground">{step.status}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Live Feed
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
