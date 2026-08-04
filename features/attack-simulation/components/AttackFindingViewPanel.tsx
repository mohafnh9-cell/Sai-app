"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { AttackCenterFindingView } from "../types";
import { PrimaryActionButton } from "@/features/security-testing/components/SecurityTestHero";
import { EvidenceReportPanel } from "@/features/evidence-finding/components/EvidenceReportPanel";

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
  const { t } = useI18n("attackCenter");
  const { t: tr } = useI18n("readiness");
  const { finding, mitigation, safeFix, evidence, protection, evidenceReport } = view;
  const severityKey = (finding.severity?.toLowerCase() ?? "high") as
    | "critical"
    | "high"
    | "medium"
    | "low"
    | "info";
  const severityLabel = tr(`severity.${severityKey}`);
  const [copied, setCopied] = useState(false);
  const isVerified = Boolean(protection);

  const copyProtection = async () => {
    if (!safeFix?.cursorPrompt) return;
    await navigator.clipboard.writeText(safeFix.cursorPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const plainEvidence =
    evidence?.observedBehavior ??
    mitigation?.plainLanguageExplanation ??
    finding.description;

  return (
    <div className="space-y-8 max-w-2xl">
      <section className="surface-premium rounded-3xl p-8 sm:p-10 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{t("finding.issueFound")}</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2">{finding.title}</h1>
        </div>

        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-5 py-4 space-y-3">
          <p className="text-sm font-medium">{t("finding.confirmed")}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{plainEvidence}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-full border border-red-500/40 px-3 py-1 text-red-400 font-medium">
              {t("finding.severity")}: {severityLabel}
            </span>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">{t("finding.evidenceSummary")}</p>
      </section>

      {!isVerified && mitigation ? (
        <section className="space-y-4">
          <h2 className="text-base font-semibold">{t("finding.protectTitle")}</h2>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3 text-sm">
            <p className="font-medium text-base">{mitigation.recommendedProtection}</p>
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
              {mitigation.implementationSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {safeFix?.cursorPrompt ? (
              <button
                type="button"
                className="text-sm text-primary underline-offset-4 hover:underline"
                onClick={() => void copyProtection()}
              >
                {copied ? t("finding.copied") : t("finding.copyProtection")}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {isVerified ? (
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-sm space-y-2">
          <p className="font-semibold text-base text-emerald-400">{t("finding.attackBlocked")}</p>
          <p className="text-muted-foreground">{protection!.summary}</p>
        </section>
      ) : (
        <section className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("finding.applyThenVerify")}</p>
          <PrimaryActionButton loading={verifying} onClick={onVerifyProtection} className="w-full sm:w-auto">
            {t("finding.verifyProtection")}
          </PrimaryActionButton>
        </section>
      )}

      <details className="rounded-2xl border border-border/60">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-muted-foreground">
          {t("finding.technicalDetails")}
        </summary>
        <div className="px-5 pb-5 space-y-4 border-t border-border/40 pt-4 text-sm">
          {evidence ? (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("finding.whatWeSaw")}</p>
              <p>
                <span className="font-medium">{t("finding.expected")}</span> {evidence.expectedBehavior}
              </p>
              <p>
                <span className="font-medium">{t("finding.observed")}</span> {evidence.observedBehavior}
              </p>
            </div>
          ) : null}
          {evidenceReport ? <EvidenceReportPanel report={evidenceReport} /> : null}
          {safeFix ? (
            <pre className="rounded-lg border border-border/60 p-3 text-xs overflow-x-auto whitespace-pre-wrap bg-muted/20">
              {safeFix.cursorPrompt}
            </pre>
          ) : null}
          <p className="text-xs text-muted-foreground font-mono">
            {t("finding.reference")} {finding.id.slice(0, 8)}
          </p>
        </div>
      </details>

      {onBack ? (
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline hover:text-foreground"
          onClick={onBack}
        >
          {t("finding.back")}
        </button>
      ) : null}
    </div>
  );
}
