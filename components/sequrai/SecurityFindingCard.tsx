"use client";

import { FileCode2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DiffContextBadge,
  findingDiffContext,
} from "./DiffContext";
import { EvidencePanel } from "./EvidencePanel";
import { SecuritySeverityBadge } from "./SecuritySeverityBadge";
import { VerificationStatusBadge } from "./VerificationStatusBadge";
import { findingVerificationStatus } from "@/lib/design-system/verification";
import {
  findingEvidenceReport,
  findingFile,
  findingLine,
  findingSnippet,
  findingStatus,
  type ScanFinding,
} from "@/features/security-scanner/components/types";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import { fixPromptInputFromFinding } from "@/brain/fix-prompt";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";
import { useI18n } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/types";

type FindingGroup = "blockers" | "warnings" | "improvements" | "informational";

function findingGroup(severity?: string): FindingGroup {
  const s = severity?.toUpperCase() ?? "";
  if (s === "CRITICAL" || s === "HIGH") return "blockers";
  if (s === "MEDIUM") return "warnings";
  if (s === "LOW") return "improvements";
  return "informational";
}

function severityDisplay(severity: string | undefined, group: FindingGroup, t: Translator) {
  if (group === "blockers") return t("productionBlocker");
  return severity ?? t("unknown");
}

export function SecurityFindingCard({
  finding,
  fixPromptContext,
}: {
  finding: ScanFinding;
  fixPromptContext?: FixPromptContext;
}) {
  const { t } = useI18n("technicalDetails");
  const path = findingFile(finding);
  const line = findingLine(finding);
  const snippet = findingSnippet(finding);
  const group = findingGroup(finding.severity);
  const isBlocker = group === "blockers";
  const evidenceReport = findingEvidenceReport(finding);
  const verificationStatus = findingVerificationStatus(finding);
  const diffContext = findingDiffContext(finding);
  const fixPromptInput = isBlocker
    ? fixPromptInputFromFinding(finding, {
        projectName: fixPromptContext?.projectName,
        stack: fixPromptContext?.stack,
        currentVerdictStatus: fixPromptContext?.currentVerdictStatus,
        currentScore: fixPromptContext?.currentScore,
      })
    : null;

  return (
    <article className="border-b border-border/50 py-5 last:border-0">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SecuritySeverityBadge
            severity={finding.severity}
            label={severityDisplay(finding.severity, group, t)}
          />
          <VerificationStatusBadge status={verificationStatus} />
          <DiffContextBadge context={diffContext} compact />
          {finding.category ? <Badge variant="secondary">{finding.category}</Badge> : null}
          {findingStatus(finding) ? <Badge variant="outline">{findingStatus(finding)}</Badge> : null}
        </div>

        <h3 className="text-base font-semibold leading-snug">{finding.title || t("untitledFinding")}</h3>

        {finding.description ? (
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{finding.description}</p>
        ) : null}

        {path ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <FileCode2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {path}
              {line !== undefined ? `:${line}` : ""}
            </span>
          </div>
        ) : null}
      </div>

      <EvidencePanel
        report={evidenceReport}
        verificationStatus={verificationStatus}
        impact={finding.impact}
        recommendation={finding.recommendation}
        className="mt-4"
      />

      {snippet ? (
        <details className="mt-3 rounded-lg border border-border/60">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground seq-focus-ring">
            {t("codeSnippet")}
          </summary>
          <pre className="overflow-x-auto border-t border-border/40 p-3 text-xs bg-muted/30">
            <code>{snippet}</code>
          </pre>
        </details>
      ) : null}

      {fixPromptInput ? (
        <div className="mt-4 pt-3 border-t border-border/40">
          <CopySafeFixPromptButton
            input={fixPromptInput}
            source="finding"
            findingId={finding.id}
          />
        </div>
      ) : null}
    </article>
  );
}
