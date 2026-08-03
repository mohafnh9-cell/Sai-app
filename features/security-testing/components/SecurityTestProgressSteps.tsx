"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { SecurityTestProgressStep } from "../types";

export function SecurityTestProgressSteps({ steps }: { steps: SecurityTestProgressStep[] }) {
  const { t } = useI18n("securityTest");

  return (
    <ol className="grid gap-3 sm:grid-cols-4">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            step.status === "current" && "border-primary/40 bg-primary/5",
            step.status === "done" && "border-border/60 bg-muted/20",
            step.status === "upcoming" && "border-border/40 text-muted-foreground"
          )}
        >
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("stepLabel", { n: index + 1 })}
          </p>
          <p className="mt-1 font-medium">{step.label}</p>
        </li>
      ))}
    </ol>
  );
}
