"use client";

import type { ProductionPriority } from "@/brain/production-verdict/schema";
import { SecuritySeverityBadge } from "@/components/sequrai";
import { useI18n } from "@/lib/i18n/client";

export function DeploymentBlockersList({
  blockers,
}: {
  blockers: ProductionPriority[];
}) {
  const { t } = useI18n("readiness");

  if (blockers.length === 0) return null;

  return (
    <section className="space-y-5" aria-labelledby="deployment-blockers-heading">
      <div>
        <h2 id="deployment-blockers-heading" className="text-lg font-semibold tracking-tight">
          {t("blockers.title", { count: blockers.length })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("blockers.subtitleReadOnly")}</p>
      </div>

      <ul className="space-y-3 list-none divide-y divide-border/50">
        {blockers.map((blocker) => (
          <li key={blocker.id} className="py-4 first:pt-0 space-y-2">
            <p className="font-medium leading-snug">{blocker.title}</p>
            {blocker.reason ? (
              <p className="text-sm text-muted-foreground leading-relaxed">{blocker.reason}</p>
            ) : null}
            <SecuritySeverityBadge severity={blocker.severity.toUpperCase()} />
          </li>
        ))}
      </ul>
    </section>
  );
}
