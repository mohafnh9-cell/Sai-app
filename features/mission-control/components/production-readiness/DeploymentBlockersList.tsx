"use client";

import { Badge } from "@/components/ui/badge";
import type { ProductionPriority } from "@/brain/production-verdict/schema";
import { useI18n } from "@/lib/i18n/client";

function severityLabel(severity: ProductionPriority["severity"], t: (key: string) => string) {
  return t(`severity.${severity}`);
}

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

      <ul className="space-y-3 list-none">
        {blockers.map((blocker) => (
          <li
            key={blocker.id}
            className="rounded-2xl border border-border/70 bg-[#101014]/50 px-5 py-4 space-y-2"
          >
            <p className="font-medium leading-snug">{blocker.title}</p>
            {blocker.reason ? (
              <p className="text-sm text-muted-foreground leading-relaxed">{blocker.reason}</p>
            ) : null}
            <Badge
              variant="outline"
              className={
                blocker.severity === "critical"
                  ? "border-red-500/40 text-red-400"
                  : "border-amber-500/40 text-amber-400"
              }
            >
              {severityLabel(blocker.severity, t)}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
