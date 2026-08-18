"use client";

import type { EvidenceReport } from "@/brain/evidence-finding/schema";
import { resolveEvidenceReportConfidenceLevel } from "@/brain/evidence-finding/schema";
import { EvidenceReportPanel } from "@/features/evidence-finding/components/EvidenceReportPanel";
import { VerificationStatusBadge } from "./VerificationStatusBadge";
import { ConfidenceLevelBadge } from "./ConfidenceLevelBadge";
import type { VerificationStatus } from "@/lib/design-system/verification";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

type EvidencePanelProps = {
  report?: EvidenceReport | null;
  verificationStatus?: VerificationStatus | null;
  impact?: string | null;
  recommendation?: string | null;
  className?: string;
  defaultOpen?: boolean;
};

/**
 * Progressive evidence disclosure — WHY SequrAI believes this.
 * Verification is visually distinct from severity.
 */
export function EvidencePanel({
  report,
  verificationStatus,
  impact,
  recommendation,
  className,
  defaultOpen = false,
}: EvidencePanelProps) {
  const { t } = useI18n("technicalDetails");

  const hasContent = Boolean(report || impact || recommendation || verificationStatus);

  if (!hasContent) return null;

  return (
    <details className={cn("group rounded-xl border border-border/60", className)} open={defaultOpen}>
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium seq-focus-ring rounded-xl flex items-center justify-between gap-3">
        <span>{t("evidenceLabel")}</span>
        <div className="flex items-center gap-2">
          {report ? (
            <ConfidenceLevelBadge level={resolveEvidenceReportConfidenceLevel(report)} />
          ) : null}
          {verificationStatus ? <VerificationStatusBadge status={verificationStatus} /> : null}
        </div>
      </summary>
      <div className="border-t border-border/40 px-4 py-4 space-y-4">
        {impact ? (
          <div>
            <p className="text-label-caps mb-1">{t("impactLabel")}</p>
            <p className="text-sm leading-relaxed">{impact}</p>
          </div>
        ) : null}
        {recommendation ? (
          <div>
            <p className="text-label-caps mb-1">{t("recommendationLabel")}</p>
            <p className="text-sm leading-relaxed">{recommendation}</p>
          </div>
        ) : null}
        {report ? <EvidenceReportPanel report={report} /> : null}
      </div>
    </details>
  );
}
