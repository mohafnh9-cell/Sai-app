"use client";

import type { WhatChangedItem } from "@/brain/production-intelligence/schema";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

type WhatChangedSectionProps = {
  items: WhatChangedItem[];
  hasChanges: boolean;
  className?: string;
};

export function WhatChangedSection({ items, hasChanges, className }: WhatChangedSectionProps) {
  const { t } = useI18n("productionIntelligence");

  if (!hasChanges || items.length === 0) {
    return (
      <section className={cn("space-y-2", className)}>
        <h2 className="text-sm font-semibold tracking-tight">{t("whatChangedTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("noSignificantChanges")}</p>
      </section>
    );
  }

  const improvements = items.filter((i) => i.kind === "improvement");
  const regressions = items.filter((i) => i.kind === "regression");

  return (
    <section className={cn("space-y-4", className)} aria-labelledby="what-changed-heading">
      <h2 id="what-changed-heading" className="text-sm font-semibold tracking-tight">
        {t("whatChangedTitle")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {improvements.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {improvements.map((item) => (
              <li key={item.id} className="flex gap-2 items-start">
                <TrendingUp className="h-4 w-4 shrink-0 text-success mt-0.5" aria-hidden />
                <span>{t(item.messageKey, item.params)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {regressions.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {regressions.map((item) => (
              <li key={item.id} className="flex gap-2 items-start">
                <TrendingDown className="h-4 w-4 shrink-0 text-danger mt-0.5" aria-hidden />
                <span>{t(item.messageKey, item.params)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
