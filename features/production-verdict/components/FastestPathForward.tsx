"use client";

import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  findingsByIdMap,
  fixPromptInputFromPriority,
  projectedVerdictAfterFix,
} from "@/brain/fix-prompt";
import type { ProductionPriority } from "@/brain/production-verdict/schema";
import { trackEvent } from "@/lib/analytics/track";
import { useI18n } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/types";
import type { FixPromptContext } from "../fix-prompt-context";
import { CopySafeFixPromptButton } from "./CopySafeFixPromptButton";
import { SafeFixMetrics } from "./SafeFixMetrics";

function severityLabel(severity: ProductionPriority["severity"], t: Translator) {
  return t(`severity.${severity}`);
}

export function ProductionPriorityItem({
  priority,
  onReview,
  fixPromptContext,
}: {
  priority: ProductionPriority;
  onReview?: () => void;
  fixPromptContext?: FixPromptContext;
}) {
  const { t } = useI18n("verdict");
  const { t: tr } = useI18n("readiness");
  const findingsMap = fixPromptContext?.findings
    ? findingsByIdMap(fixPromptContext.findings)
    : undefined;
  const fixPromptInput = fixPromptInputFromPriority(priority, {
    projectName: fixPromptContext?.projectName,
    stack: fixPromptContext?.stack,
    findingsById: findingsMap,
    currentVerdictStatus: fixPromptContext?.currentVerdictStatus,
    currentScore: fixPromptContext?.currentScore,
  });
  const projectedVerdict = projectedVerdictAfterFix(fixPromptInput);

  return (
    <li className="group relative rounded-xl border border-border/70 bg-[#101014]/60 p-4 md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/80 text-xs font-semibold">
              {priority.rank}
            </span>
            <h4 className="text-base font-medium leading-snug">{priority.title}</h4>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("whyItMatters")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{priority.reason}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="text-xs">
              {priority.category}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {t("technicalSeverity")}: {severityLabel(priority.severity, tr)}
            </Badge>
          </div>

          {priority.affectedFiles.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("affected")}:{" "}
              <code className="text-foreground/90">
                {priority.affectedFiles.slice(0, 3).join(", ")}
                {priority.affectedFiles.length > 3
                  ? ` ${t("moreAffected", { count: priority.affectedFiles.length - 3 })}`
                  : ""}
              </code>
            </p>
          )}
        </div>

        <div className="shrink-0 space-y-3 text-sm md:text-right md:min-w-[160px]">
          <div>
            <p className="text-xs text-muted-foreground">{t("estimatedTime")}</p>
            <p className="font-medium">{priority.estimatedTimeLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("projectedVerdictAfterFix")}</p>
            <p className="font-medium">{projectedVerdict}</p>
          </div>
          <SafeFixMetrics input={fixPromptInput} />
          <div className="flex flex-col gap-2 md:items-end">
            <CopySafeFixPromptButton
              input={fixPromptInput}
              source="priority"
              priorityId={priority.id}
              className="w-full md:w-auto"
            />
            {onReview && (
              <button
                type="button"
                onClick={() => {
                  trackEvent("priority_opened", { priorityId: priority.id, rank: priority.rank });
                  onReview();
                }}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
              >
                {t("reviewFix")}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm border-t border-border/50 pt-3 text-foreground/90">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-2">
          {t("action")}
        </span>
        {priority.recommendedAction}
      </p>
    </li>
  );
}

export function FastestPathForward({
  priorities,
  onReviewPriority,
  fixPromptContext,
  titleKey = "criticalBlockersTitle",
  subtitleKey = "criticalBlockersSubtitle",
}: {
  priorities: ProductionPriority[];
  onReviewPriority?: (priority: ProductionPriority) => void;
  fixPromptContext?: FixPromptContext;
  titleKey?: string;
  subtitleKey?: string;
}) {
  const { t } = useI18n("verdict");

  if (priorities.length === 0) return null;

  return (
    <section aria-labelledby="fastest-path-heading" className="space-y-4">
      <div>
        <h2 id="fastest-path-heading" className="text-lg font-semibold tracking-tight">
          {t(titleKey)}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">{t(subtitleKey)}</p>
      </div>
      <ol className="space-y-3 list-none">
        {priorities.slice(0, 3).map((priority) => (
          <ProductionPriorityItem
            key={priority.id}
            priority={priority}
            onReview={onReviewPriority ? () => onReviewPriority(priority) : undefined}
            fixPromptContext={fixPromptContext}
          />
        ))}
      </ol>
    </section>
  );
}
