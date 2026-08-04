"use client";

import { Check } from "lucide-react";
import { PROGRESS_STEPS, resolveProgressIndex, type OnboardingContext, type WizardStep } from "../onboarding-flow";
import { useI18n } from "@/lib/i18n/client";

export function OnboardingProgressTracker({
  wizardStep,
  context,
}: {
  wizardStep: WizardStep;
  context: Pick<
    OnboardingContext,
    "githubConnected" | "projects" | "activeScan" | "latestCompletedScan" | "latestVerdict"
  >;
}) {
  const { t } = useI18n("onboarding");
  const activeIndex = resolveProgressIndex(wizardStep, context);

  return (
    <nav aria-label={t("progressNavAriaLabel")} className="w-full">
      <ol className="flex flex-col gap-0 sm:gap-1">
        {PROGRESS_STEPS.map((step, index) => {
          const done = index < activeIndex;
          const current = index === activeIndex;
          const upcoming = index > activeIndex;

          return (
            <li key={step.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : current
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-secondary text-muted-foreground"
                  }`}
                  aria-current={current ? "step" : undefined}
                >
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                </span>
                {index < PROGRESS_STEPS.length - 1 && (
                  <span
                    className={`my-1 h-6 w-px sm:h-4 ${done ? "bg-primary" : "bg-border"}`}
                    aria-hidden
                  />
                )}
              </div>
              <div className={`pb-4 sm:pb-3 ${upcoming ? "opacity-50" : ""}`}>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {t("progressStepLabel", { step: index + 1 })}
                </p>
                <p
                  className={`text-sm ${
                    current ? "font-medium text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t(step.labelKey)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
