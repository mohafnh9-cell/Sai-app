"use client";

import { Button } from "@/components/ui/button";
import type { AttackCenterFindingView } from "../types";

export function AttackFindingViewPanel({
  view,
  onReplay,
  replaying,
  onBack,
}: {
  view: AttackCenterFindingView;
  onReplay: () => void;
  replaying: boolean;
  onBack?: () => void;
}) {
  const { finding, mitigation, safeFix, evidence, protection } = view;

  return (
    <div className="space-y-8">
      <section className="surface-premium rounded-3xl p-8 sm:p-10 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">How to fix it</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2">{finding.title}</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground">{finding.description}</p>
        <p className="text-sm">
          <span className="font-medium">How bad is it?</span>{" "}
          <span className="capitalize">{finding.severity}</span>
        </p>
      </section>

      {evidence ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">What we saw</h2>
          <div className="rounded-xl border border-border/60 p-5 space-y-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Should happen</p>
              <p className="mt-1">{evidence.expectedBehavior}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">What happened</p>
              <p className="mt-1">{evidence.observedBehavior}</p>
            </div>
          </div>
        </section>
      ) : null}

      {mitigation ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">How to protect your app</h2>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3 text-sm">
            <p>{mitigation.plainLanguageExplanation}</p>
            <p className="font-medium text-base">{mitigation.recommendedProtection}</p>
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
              {mitigation.implementationSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      {safeFix ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Copy this into Cursor to fix it</h2>
          <pre className="rounded-xl border border-border/60 p-4 text-xs overflow-x-auto whitespace-pre-wrap bg-muted/20">
            {safeFix.cursorPrompt}
          </pre>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Did the fix work?</h2>
        <div className="rounded-xl border border-border/60 p-5 text-sm">
          {protection ? (
            <>
              <p className="font-medium">{protection.summary}</p>
            </>
          ) : (
            <p className="text-muted-foreground">
              After you fix the problem, run the test again to check your app is protected.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="lg" onClick={onReplay} disabled={replaying}>
            {replaying ? "Testing again…" : "Test my fix"}
          </Button>
          {onBack ? (
            <Button type="button" variant="outline" size="lg" onClick={onBack}>
              Back to all tests
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
