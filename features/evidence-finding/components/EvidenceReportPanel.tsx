"use client";

import { useState } from "react";
import type { EvidenceItem, EvidenceReport, RuleInfo } from "@/brain/evidence-finding/schema";
import { resolveEvidenceReportConfidenceLevel } from "@/brain/evidence-finding/schema";
import { ConfidenceLevelBadge } from "@/components/sequrai/ConfidenceLevelBadge";
import { useI18n } from "@/lib/i18n/client";

function EvidenceList({ title, items }: { title: string; items: EvidenceItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-border/60">
            <details className="group">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium list-none flex items-center justify-between">
                <span>✓ {item.label}</span>
                {item.confidence != null ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.round(item.confidence * 100)}%
                  </span>
                ) : null}
              </summary>
              {item.detail ? (
                <div className="px-4 pb-3 text-sm text-muted-foreground whitespace-pre-wrap border-t border-border/40 pt-3">
                  {item.detail}
                </div>
              ) : null}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RuleBlock({ rule }: { rule: RuleInfo }) {
  const { t } = useI18n("evidenceFinding");

  return (
    <div className="rounded-lg border border-border/50 px-3 py-2 text-xs space-y-1">
      <p className="font-medium">{rule.ruleName}</p>
      {rule.ruleDescription ? <p className="text-muted-foreground">{rule.ruleDescription}</p> : null}
      <p className="text-muted-foreground">
        {t("ruleId")} {rule.ruleId}
      </p>
      {rule.cwe?.length ? (
        <p className="text-muted-foreground">
          {t("cwe")} {rule.cwe.join(", ")}
        </p>
      ) : null}
      {rule.owasp?.length ? (
        <p className="text-muted-foreground">
          {t("owasp")} {rule.owasp.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

export function EvidenceReportPanel({ report }: { report: EvidenceReport }) {
  const { t } = useI18n("evidenceFinding");
  const [showTechnical, setShowTechnical] = useState(false);
  const confidenceLevel = resolveEvidenceReportConfidenceLevel(report);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="rounded-xl border border-border/60 px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("confidence")}</p>
          <div className="mt-2">
            <ConfidenceLevelBadge level={confidenceLevel} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">{report.confidencePercent}% score</p>
        </div>
        <div className="rounded-xl border border-border/60 px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("falsePositive")}</p>
          <p className="mt-1 font-semibold tabular-nums">{report.falsePositivePercent}%</p>
        </div>
        <div className="rounded-xl border border-border/60 px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("detection")}</p>
          <p className="mt-1 font-medium">{report.detectionMethod.replaceAll("_", " ")}</p>
        </div>
        <div className="rounded-xl border border-border/60 px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("status")}</p>
          <p className="mt-1 font-medium">{report.statusLabel}</p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{report.confidenceExplanation}</p>
      <p className="text-sm text-muted-foreground">{report.falsePositiveExplanation}</p>

      <EvidenceList title={t("evidence")} items={report.evidence} />
      <EvidenceList title={t("counterEvidence")} items={report.counterEvidence} />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("reasoning")}</h3>
        <p className="text-sm text-muted-foreground">{report.reasoning}</p>
      </section>

      {report.recommendedFix ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("recommendedFix")}</h3>
          <p className="text-sm">{report.recommendedFix}</p>
        </section>
      ) : null}

      <button
        type="button"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        onClick={() => setShowTechnical((value) => !value)}
      >
        {showTechnical ? t("hideDetails") : t("showDetails")}
      </button>

      {showTechnical ? (
        <div className="space-y-4 rounded-xl border border-border/60 p-4 text-sm">
          {report.affectedFiles.length > 0 ? (
            <div className="space-y-2">
              <p className="font-medium">{t("affectedFiles")}</p>
              <ul className="space-y-1 text-muted-foreground">
                {report.affectedFiles.map((file) => (
                  <li key={`${file.path}:${file.line ?? 0}`}>
                    {file.path}
                    {file.line ? `:${file.line}` : ""}
                    {file.column ? `:${file.column}` : ""}
                    {file.matchedRule ? ` · ${file.matchedRule}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.matchedRules.length > 0 ? (
            <div className="space-y-2">
              <p className="font-medium">{t("rules")}</p>
              <div className="space-y-2">
                {report.matchedRules.map((rule) => (
                  <RuleBlock key={rule.ruleId} rule={rule} />
                ))}
              </div>
            </div>
          ) : null}
          {report.runtimeEvidence?.length ? (
            <EvidenceList title={t("runtimeEvidence")} items={report.runtimeEvidence} />
          ) : null}
          {report.replayEvidence?.length ? (
            <EvidenceList title={t("replayEvidence")} items={report.replayEvidence} />
          ) : null}
          {report.verificationStatus ? (
            <p className="text-muted-foreground">
              {t("verification")} {report.verificationStatus}
            </p>
          ) : null}
          {report.projectType ? (
            <p className="text-muted-foreground">
              {t("projectType")} {report.projectType.replaceAll("_", " ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
