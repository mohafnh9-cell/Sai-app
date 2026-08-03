"use client";

import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n/client";
import type { AttackCenterExecutionView } from "../types";
import { executionStatusLabel, humanFeedLabel } from "@/features/security-testing/lib/live-test-copy";

export function AttackExecutionViewPanel({ view }: { view: AttackCenterExecutionView }) {
  const { t: ts } = useI18n("securityTest");
  const { t: ta } = useI18n("attackCenter");
  const { execution, steps, feed } = view;
  const statusLabel = executionStatusLabel(execution.status, ts);

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="surface-premium rounded-3xl p-8 space-y-4">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{ta("execution.title")}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{ta("execution.inProgress")}</h1>
        <p className="text-sm text-muted-foreground">{ta("execution.waitMessage")}</p>
        <div className="rounded-xl border border-border/60 px-4 py-3 inline-block text-sm font-medium">
          {statusLabel}
        </div>
        <div className="space-y-2">
          <Progress value={execution.progressPercent} className="h-2" />
        </div>
      </section>

      <details className="rounded-2xl border border-border/60">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-muted-foreground">
          {ta("execution.technicalDetails")}
        </summary>
        <div className="px-5 pb-5 border-t border-border/40 pt-4 space-y-4">
          {steps.length > 0 ? (
            <ol className="space-y-2 text-sm">
              {steps.map((step) => (
                <li key={step.id} className="flex justify-between gap-3 border-b border-border/30 pb-2">
                  <span>{step.label}</span>
                  <span className="text-xs text-muted-foreground capitalize">{step.status}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {feed.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {feed.map((item) => (
                <li key={item.id}>{humanFeedLabel(item.label, ts)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    </div>
  );
}
