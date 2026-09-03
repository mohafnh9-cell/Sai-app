"use client";

import { useState } from "react";
import { ChevronDown, FileCode2 } from "lucide-react";
import {
  DiffContextBadge,
  findingDiffContext,
} from "./DiffContext";
import { EvidenceReportPanel } from "@/features/evidence-finding/components/EvidenceReportPanel";
import { resolveEvidenceReportConfidenceLevel } from "@/brain/evidence-finding/schema";
import { ConfidenceLevelBadge } from "./ConfidenceLevelBadge";
import { SecuritySeverityBadge } from "./SecuritySeverityBadge";
import { VerificationStatusBadge } from "./VerificationStatusBadge";
import { findingVerificationStatus } from "@/lib/design-system/verification";
import { severitySurfaceClass } from "@/lib/design-system/severity";
import { cn } from "@/lib/utils";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  resolutionStatus,
}: {
  finding: ScanFinding;
  fixPromptContext?: FixPromptContext;
  /** Backend-computed identity vs. the previous completed scan — never derived client-side. */
  resolutionStatus?: "new" | "unchanged" | "ambiguous";
}) {
  const { t } = useI18n("technicalDetails");
  const { t: tv } = useI18n("verdict");
  const [evidenceOpen, setEvidenceOpen] = useState(false);

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

  const otherAffectedFiles =
    evidenceReport?.affectedFiles.filter((file) => file.path !== path) ?? [];

  const hasEvidenceContent = Boolean(evidenceReport || snippet);

  return (
    <article
      className={cn(
        "rounded-lg border px-4 py-4 sm:px-5",
        severitySurfaceClass(finding.severity),
        isBlocker && "border-l-4"
      )}
    >
      {/* Severity + finding + location */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <SecuritySeverityBadge
            severity={finding.severity}
            label={severityDisplay(finding.severity, group, t)}
          />
          <VerificationStatusBadge status={verificationStatus} />
          <DiffContextBadge context={diffContext} compact />
        </div>
        <h3 className="text-lg font-semibold leading-snug tracking-tight">{finding.title || t("untitledFinding")}</h3>
        {path ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <FileCode2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {path}
              {line !== undefined ? `:${line}` : ""}
            </span>
          </div>
        ) : null}
        {(finding.category || findingStatus(finding) || resolutionStatus) ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {finding.category ? <span>{finding.category}</span> : null}
            {finding.category && findingStatus(finding) ? <span aria-hidden>·</span> : null}
            {findingStatus(finding) ? <span>{findingStatus(finding)}</span> : null}
            {resolutionStatus ? (
              <>
                {(finding.category || findingStatus(finding)) ? <span aria-hidden>·</span> : null}
                <span
                  className={cn(
                    "font-medium",
                    resolutionStatus === "ambiguous" ? "text-warning" : "text-foreground"
                  )}
                >
                  {resolutionStatus === "unchanged"
                    ? t("resolutionUnchanged")
                    : resolutionStatus === "ambiguous"
                      ? t("resolutionAmbiguous")
                      : t("resolutionNew")}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Why it matters — always visible, never buried */}
      {(finding.description || finding.impact) ? (
        <div className="mt-4 space-y-2 border-t border-border/40 pt-4">
          <p className="text-label-caps">{tv("whyItMatters")}</p>
          {finding.description ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{finding.description}</p>
          ) : null}
          {finding.impact && finding.impact !== finding.description ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{finding.impact}</p>
          ) : null}
        </div>
      ) : null}

      {/* Evidence — visible summary, expandable technical depth */}
      {hasEvidenceContent ? (
        <Collapsible
          open={evidenceOpen}
          onOpenChange={setEvidenceOpen}
          className="mt-4 border-t border-border/40 pt-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-label-caps">{t("evidenceLabel")}</p>
              {evidenceReport ? (
                <ConfidenceLevelBadge level={resolveEvidenceReportConfidenceLevel(evidenceReport)} />
              ) : null}
            </div>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground seq-transition seq-focus-ring rounded-sm"
              >
                {evidenceOpen ? t("hideEvidence") : t("showEvidence")}
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", evidenceOpen && "rotate-180")}
                  aria-hidden
                />
              </button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="mt-3 space-y-4">
            {snippet ? (
              <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/30 p-3 text-xs font-mono">
                <code>{snippet}</code>
              </pre>
            ) : null}
            {evidenceReport ? <EvidenceReportPanel report={evidenceReport} /> : null}
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {/* Recommended fix — distinct from "why it matters" */}
      {finding.recommendation ? (
        <div className="mt-4 space-y-1.5 border-t border-border/40 pt-4">
          <p className="text-label-caps">{t("recommendationLabel")}</p>
          <p className="text-sm leading-relaxed">{finding.recommendation}</p>
        </div>
      ) : null}

      {/* Affected files — compact list, only when there's more than the primary location */}
      {otherAffectedFiles.length > 0 ? (
        <div className="mt-3 space-y-1">
          <p className="text-label-caps">{t("affectedFilesLabel")}</p>
          <ul className="space-y-0.5">
            {otherAffectedFiles.map((file) => (
              <li
                key={`${file.path}:${file.line ?? 0}`}
                className="truncate font-mono text-xs text-muted-foreground"
              >
                {file.path}
                {file.line ? `:${file.line}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Action */}
      {fixPromptInput ? (
        <div className="mt-4 pt-3 border-t border-border/40">
          <CopySafeFixPromptButton
            input={fixPromptInput}
            source="finding"
            findingId={finding.id}
          />
        </div>
      ) : null}

      {/* Verification — state-aware when the backend has a real answer, generic otherwise */}
      {isBlocker || resolutionStatus ? (
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">{t("verificationLabel")}. </span>
          {resolutionStatus === "unchanged"
            ? t("resolutionUnchangedBody")
            : resolutionStatus === "ambiguous"
              ? t("resolutionAmbiguousBody")
              : resolutionStatus === "new"
                ? t("resolutionNewBody")
                : t("verificationBody")}
        </p>
      ) : null}
    </article>
  );
}
