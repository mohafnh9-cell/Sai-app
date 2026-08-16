"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

export function AttackSimulationFlowSteps({
  currentStep,
}: {
  currentStep: 1 | 2 | 3;
}) {
  const { t } = useI18n("attackCenter");
  const steps = [
    { id: 1, title: t("page.step1Title"), body: t("page.step1Body") },
    { id: 2, title: t("page.step2Title"), body: t("page.step2Body") },
    { id: 3, title: t("page.step3Title"), body: t("page.step3Body") },
  ] as const;

  return (
    <ol className="grid gap-2 sm:grid-cols-3 text-sm">
      {steps.map((step) => {
        const status =
          step.id < currentStep ? "done" : step.id === currentStep ? "current" : "upcoming";
        return (
          <li
            key={step.id}
            className={cn(
              "rounded-xl border px-4 py-3",
              status === "current" && "border-primary/40 bg-primary/5",
              status === "done" && "border-emerald-500/30 bg-emerald-500/5",
              status === "upcoming" && "border-border/40 bg-muted/10 text-muted-foreground"
            )}
          >
            <p className="font-medium text-foreground">{step.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{step.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
