"use client";

import { useState } from "react";
import type { AttackCenterFindingView } from "../types";
import { PrimaryActionButton } from "@/features/security-testing/components/SecurityTestHero";

export function AttackFindingViewPanel({
  view,
  onVerifyProtection,
  verifying,
  onBack,
}: {
  view: AttackCenterFindingView;
  onVerifyProtection: () => void;
  verifying: boolean;
  onBack?: () => void;
}) {
  const { finding, mitigation, safeFix, evidence, protection } = view;
  const [copied, setCopied] = useState(false);
  const isVerified = Boolean(protection);

  const copyProtection = async () => {
    if (!safeFix?.cursorPrompt) return;
    await navigator.clipboard.writeText(safeFix.cursorPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <section className="surface-premium rounded-3xl p-8 sm:p-10 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Problem found</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2">{finding.title}</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground">{finding.description}</p>
      </section>

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

      {isVerified ? (
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-sm">
          <p className="font-medium text-base">Protection verified</p>
          <p className="mt-2 text-muted-foreground">{protection!.summary}</p>
        </section>
      ) : (
        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Apply the protection above, then verify it works.
          </p>
          <PrimaryActionButton loading={verifying} onClick={onVerifyProtection}>
            Verify protection
          </PrimaryActionButton>
        </section>
      )}

      <details className="rounded-2xl border border-border/60">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-muted-foreground">
          Technical details
        </summary>
        <div className="px-5 pb-5 space-y-4 border-t border-border/40 pt-4 text-sm">
          {evidence ? (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">What we saw</p>
              <p>
                <span className="font-medium">Expected:</span> {evidence.expectedBehavior}
              </p>
              <p>
                <span className="font-medium">Observed:</span> {evidence.observedBehavior}
              </p>
            </div>
          ) : null}
          {safeFix ? (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Protection for Cursor</p>
              <pre className="rounded-lg border border-border/60 p-3 text-xs overflow-x-auto whitespace-pre-wrap bg-muted/20">
                {safeFix.cursorPrompt}
              </pre>
              <button
                type="button"
                className="text-sm text-primary underline-offset-4 hover:underline"
                onClick={() => void copyProtection()}
              >
                {copied ? "Copied" : "Copy protection"}
              </button>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground font-mono">Reference: {finding.id.slice(0, 8)}</p>
        </div>
      </details>

      {onBack ? (
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline hover:text-foreground"
          onClick={onBack}
        >
          ← Back
        </button>
      ) : null}
    </div>
  );
}
