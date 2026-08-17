"use client";

import type { ProductionPriority } from "@/brain/production-verdict/schema";
import type { ScanFinding } from "@/features/security-scanner/components/types";
import { SecuritySeverityBadge } from "./SecuritySeverityBadge";
import { VerificationStatusBadge } from "./VerificationStatusBadge";
import { DiffContextBadge, findingDiffContext } from "./DiffContext";
import { findingVerificationStatus } from "@/lib/design-system/verification";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

type TopRisksListProps = {
  blockers: ProductionPriority[];
  findingsById?: Map<string, ScanFinding>;
  className?: string;
  onSelect?: (id: string) => void;
};

export function TopRisksList({ blockers, findingsById, className, onSelect }: TopRisksListProps) {
  const { t } = useI18n("readiness");

  if (blockers.length === 0) return null;

  return (
    <section className={cn("space-y-4", className)} aria-labelledby="top-risks-heading">
      <div>
        <h2 id="top-risks-heading" className="text-sm font-semibold tracking-tight uppercase">
          {t("blockers.title", { count: blockers.length })}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("blockers.subtitleReadOnly")}</p>
      </div>
      <ul className="divide-y divide-border/50 list-none">
        {blockers.slice(0, 5).map((blocker) => {
          const finding = blocker.findingIds[0]
            ? findingsById?.get(blocker.findingIds[0])
            : undefined;
          const verification = finding ? findingVerificationStatus(finding) : null;
          const diffContext = finding ? findingDiffContext(finding) : null;

          return (
            <li key={blocker.id}>
              <button
                type="button"
                className="w-full text-left py-4 seq-transition hover:bg-accent/20 seq-focus-ring rounded-lg px-2 -mx-2"
                onClick={() => onSelect?.(blocker.id)}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <SecuritySeverityBadge severity={blocker.severity.toUpperCase()} />
                  <VerificationStatusBadge status={verification} />
                  <DiffContextBadge context={diffContext} compact />
                </div>
                <p className="font-medium leading-snug">{blocker.title}</p>
                {blocker.reason ? (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{blocker.reason}</p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
