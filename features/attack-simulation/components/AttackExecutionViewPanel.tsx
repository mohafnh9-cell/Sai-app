"use client";

import { Progress } from "@/components/ui/progress";
import type { AttackCenterExecutionView } from "../types";
import { executionStatusLabel } from "@/features/security-testing/lib/live-test-copy";

export function AttackExecutionViewPanel({
  view,
  onOpenFinding,
}: {
  view: AttackCenterExecutionView;
  onOpenFinding?: (findingId: string) => void;
}) {
  const { execution, steps, feed } = view;
  const statusLabel = executionStatusLabel(execution.status);
  const canShowFix =
    execution.status === "fix_ready" || execution.status === "confirmed";

  return (
    <div className="space-y-8">
      <section className="surface-premium rounded-3xl p-8 sm:p-10 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">One test</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2">
            {canShowFix ? "We found something" : "Testing in progress"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {canShowFix
              ? "This safe attack worked. You can see how to protect your app next."
              : "We are running a safe attack to see if anything breaks."}
          </p>
        </div>

        <div className="rounded-xl border border-border/60 px-4 py-3 inline-block text-sm font-medium">
          {statusLabel}
        </div>

        {!canShowFix ? (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span className="tabular-nums">{execution.progressPercent}%</span>
            </div>
            <Progress value={execution.progressPercent} className="h-2" />
          </div>
        ) : onOpenFinding ? (
          <p className="text-sm text-muted-foreground">
            Go back to the test list and tap &quot;Show me how to fix it&quot;.
          </p>
        ) : null}
      </section>

      {steps.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Steps</h2>
          <ol className="space-y-2">
            {steps.map((step) => (
              <li
                key={step.id}
                className="rounded-xl border border-border/60 px-4 py-3 flex items-center justify-between gap-3 text-sm"
              >
                <p className="font-medium">{step.label}</p>
                <span className="text-xs text-muted-foreground capitalize">{step.status}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {feed.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">What happened</h2>
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {feed.map((item) => (
              <li key={item.id} className="text-sm py-2 border-b border-border/40 last:border-0">
                {item.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
