"use client";

import { Button } from "@/components/ui/button";
import type { AttackCenterFindingView } from "../types";

export function AttackFindingViewPanel({
  view,
  onReplay,
  replaying,
}: {
  view: AttackCenterFindingView;
  onReplay: () => void;
  replaying: boolean;
}) {
  const { finding, mitigation, safeFix, evidence, protection } = view;

  return (
    <div className="space-y-10">
      <section className="surface-premium rounded-3xl p-8 sm:p-10 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Attack Center</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2">{finding.title}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{finding.description}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-border px-3 py-1 capitalize">{finding.severity}</span>
          <span className="rounded-full border border-border px-3 py-1 capitalize">{finding.outcome}</span>
          <span className="rounded-full border border-border px-3 py-1">
            Confidence {Math.round(finding.confidence * 100)}%
          </span>
        </div>
      </section>

      {evidence ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Evidence</h2>
          <div className="rounded-xl border border-border/60 p-4 space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Expected</p>
              <p className="mt-1">{evidence.expectedBehavior}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Observed</p>
              <p className="mt-1">{evidence.observedBehavior}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Reproducibility</p>
              <p className="mt-1 capitalize">{evidence.reproducibility.replaceAll("_", " ")}</p>
            </div>
          </div>
        </section>
      ) : null}

      {mitigation ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Recommended Protection
          </h2>
          <div className="rounded-xl border border-border/60 p-4 space-y-3 text-sm">
            <p>{mitigation.plainLanguageExplanation}</p>
            <p className="font-medium">{mitigation.recommendedProtection}</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              {mitigation.implementationSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      {safeFix ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Safe Fix</h2>
          <pre className="rounded-xl border border-border/60 p-4 text-xs overflow-x-auto whitespace-pre-wrap">
            {safeFix.cursorPrompt}
          </pre>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Protection Verification
        </h2>
        <div className="rounded-xl border border-border/60 p-4 text-sm">
          {protection ? (
            <>
              <p className="font-medium capitalize">{protection.outcome.replaceAll("_", " ")}</p>
              <p className="mt-2 text-muted-foreground">{protection.summary}</p>
            </>
          ) : (
            <p className="text-muted-foreground">No protection replay has been verified yet.</p>
          )}
        </div>
        <Button type="button" variant="outline" onClick={onReplay} disabled={replaying}>
          {replaying ? "Replaying attack…" : "Replay attack to verify protection"}
        </Button>
      </section>
    </div>
  );
}
