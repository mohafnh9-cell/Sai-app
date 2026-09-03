"use client";

import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SecuritySeverityBadge } from "@/components/sequrai/SecuritySeverityBadge";
import type { ProductionFixPromptInput } from "@/brain/fix-prompt";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";
import { radius, surface } from "@/lib/design-system/tokens";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

type SafeFixHeroCardLabels = {
  eyebrow?: string;
  stepOne?: string;
  stepTwo?: string;
  stepThree?: string;
  copyLabel?: string;
  copiedLabel?: string;
};

/**
 * The AI Fix moment: a structured engineering workflow (problem, why it
 * matters, proposed fix, steps, action), not an AI-generated answer card.
 * Shares surface/radius tokens with the rest of the app shell -- no
 * gradient, glow, or component-local color.
 */
export function SafeFixHeroCard({
  topPriority,
  fixPromptInput,
  labels,
  className = "",
}: {
  topPriority: NonNullable<ProductionVerdictV1["topPriorities"][number]>;
  fixPromptInput: ProductionFixPromptInput;
  labels?: SafeFixHeroCardLabels;
  className?: string;
}) {
  const { t } = useI18n("projects");
  const { t: tv } = useI18n("verdict");

  const eyebrow = labels?.eyebrow ?? t("fixThisFirst");
  const steps = labels?.stepThree
    ? [labels.stepOne ?? t("safeFixStep1Body"), labels.stepTwo ?? t("safeFixStep2Body"), labels.stepThree]
    : labels?.stepOne && labels?.stepTwo
      ? [labels.stepOne, labels.stepTwo]
      : [t("safeFixStep1Body"), t("safeFixStep2Body"), t("safeFixStep3Body")];
  const copyLabel = labels?.copyLabel ?? t("copySafeFix");
  const copiedLabel = labels?.copiedLabel ?? t("copiedSafeFix");

  return (
    <section
      className={cn(radius.md, "border p-6 sm:p-8", surface.base, "seq-transition", className)}
      aria-labelledby="safe-fix-hero-heading"
    >
      {/* Problem */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-eyebrow">{eyebrow}</p>
        <SecuritySeverityBadge severity={topPriority.severity} />
        <Badge variant="outline" className="text-xs">
          {topPriority.category}
        </Badge>
      </div>
      <h2 id="safe-fix-hero-heading" className="mt-3 text-lg font-semibold tracking-tight leading-snug">
        {topPriority.title}
      </h2>

      {/* Why it matters + Proposed fix */}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-label-caps">{tv("whyItMatters")}</p>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{topPriority.reason}</p>
        </div>
        <div>
          <p className="text-label-caps">{tv("action")}</p>
          <p className="mt-1.5 text-sm text-foreground/90 leading-relaxed">{topPriority.recommendedAction}</p>
        </div>
      </div>

      {topPriority.affectedFiles.length > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {tv("affected")}:{" "}
          <code className="text-foreground/80">
            {topPriority.affectedFiles.slice(0, 3).join(", ")}
            {topPriority.affectedFiles.length > 3
              ? ` ${tv("moreAffected", { count: topPriority.affectedFiles.length - 3 })}`
              : ""}
          </code>
        </p>
      ) : null}

      {/* Implementation steps -- the last step is always "verify by rescanning" */}
      <ol className="mt-6 space-y-3 border-t border-border pt-5">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li key={step} className="flex items-start gap-3 text-sm">
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold tabular-nums",
                  isLast ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                )}
                aria-hidden
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className={cn("leading-relaxed pt-0.5", isLast ? "text-foreground" : "text-muted-foreground")}>
                {isLast ? <RefreshCw className="mr-1.5 -mt-0.5 inline h-3.5 w-3.5" aria-hidden /> : null}
                {step}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Primary action */}
      <div className="mt-6">
        <CopySafeFixPromptButton
          input={fixPromptInput}
          source="priority"
          priorityId={topPriority.id}
          size="default"
          variant="default"
          className="w-full h-11"
          label={copyLabel}
          copiedLabel={copiedLabel}
        />
      </div>
    </section>
  );
}
