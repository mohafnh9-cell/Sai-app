"use client";

import type { ProductionFixPromptInput } from "@/brain/fix-prompt";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";
import { useI18n } from "@/lib/i18n/client";

type SafeFixHeroCardLabels = {
  eyebrow?: string;
  stepOne?: string;
  stepTwo?: string;
  stepThree?: string;
  copyLabel?: string;
  copiedLabel?: string;
};

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
      className={`rounded-3xl border border-primary/25 bg-gradient-to-b from-primary/10 via-[#101014]/80 to-[#101014]/60 p-6 sm:p-8 shadow-[0_0_60px_-24px_rgba(var(--primary-rgb,99,102,241),0.35)] ${className}`}
      aria-labelledby="safe-fix-hero-heading"
    >
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary mb-2">{eyebrow}</p>
      <h2 id="safe-fix-hero-heading" className="text-lg font-semibold tracking-tight">
        {topPriority.title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{topPriority.reason}</p>
      <ol className="mt-6 space-y-3 text-sm text-muted-foreground list-decimal list-inside">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mt-6">
        <CopySafeFixPromptButton
          input={fixPromptInput}
          source="priority"
          priorityId={topPriority.id}
          size="default"
          variant="default"
          className="w-full h-12 text-base"
          label={copyLabel}
          copiedLabel={copiedLabel}
        />
      </div>
    </section>
  );
}
