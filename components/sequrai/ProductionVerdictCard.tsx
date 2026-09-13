"use client";

import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { verdictToneClass } from "@/brain/production-verdict/status-ui";
import { IntelligenceSurface } from "./IntelligenceSurface";
import { ProductionReadinessScore } from "./ProductionReadinessScore";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { RecommendedAction } from "./RecommendedAction";
import { InfoTip } from "@/components/shared/InfoTip";
import { cn } from "@/lib/utils";

type ProductionVerdictCardProps = {
  eyebrow: string;
  headline: string;
  status: VerdictStatus;
  score?: number | null;
  scoreLabel?: string;
  sourceBadge?: React.ReactNode;
  /** Concise "why" sentence -- what's actually driving this verdict, before the reader gets to the top blocker. */
  why?: string | null;
  blocker?: {
    eyebrow: string;
    title: string;
    description?: string | null;
  } | null;
  footerLink?: { href: string; label: string } | null;
  /** Real backend fields (ProductionVerdictV1.confidence / .blockersCount) -- optional so callers with no verdict data yet render exactly as before. */
  stats?: {
    scoreHelp: { label: string; title: string; body: string };
    confidence?: { value: string; label: string; title: string; body: string } | null;
    blockers?: { count: number; label: string; title: string; body: string } | null;
  } | null;
  children?: React.ReactNode;
  className?: string;
  id?: string;
  headingId?: string;
};

/**
 * Canonical Production Verdict surface — decision-first hierarchy.
 * Visual only; pass data from hooks/services.
 */
export function ProductionVerdictCard({
  eyebrow,
  headline,
  status,
  score = null,
  scoreLabel,
  sourceBadge,
  why,
  blocker,
  footerLink,
  stats = null,
  children,
  className,
  id = "production-verdict-detail",
  headingId = "production-verdict-heading",
}: ProductionVerdictCardProps) {
  return (
    <IntelligenceSurface
      id={id}
      aria-labelledby={headingId}
      toneClass={verdictToneClass(status)}
      className={cn("product-hero", className)}
    >
      <div className="relative z-[1]">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-eyebrow">{eyebrow}</p>
          {sourceBadge}
        </div>

        <div className="mt-4 space-y-3">
          <VerdictStatusBadge status={status} />
          <p id={headingId} className="text-display-headline">
            {headline}
          </p>
        </div>

        {stats ? (
          <div className="mt-6 flex flex-wrap items-start gap-x-10 gap-y-5">
            <div>
              <InfoTip
                label={stats.scoreHelp.label}
                title={stats.scoreHelp.title}
                body={stats.scoreHelp.body}
              />
              <ProductionReadinessScore score={score ?? null} status={status} size="secondary" className="mt-2" />
            </div>
            {stats.confidence ? (
              <div>
                <InfoTip
                  label={stats.confidence.label}
                  title={stats.confidence.title}
                  body={stats.confidence.body}
                />
                <p className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight leading-none">
                  {stats.confidence.value}
                </p>
              </div>
            ) : null}
            {stats.blockers ? (
              <div>
                <InfoTip
                  label={stats.blockers.label}
                  title={stats.blockers.title}
                  body={stats.blockers.body}
                />
                <p
                  className={cn(
                    "mt-2 text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight leading-none",
                    stats.blockers.count > 0 ? "text-danger" : "text-success"
                  )}
                >
                  {stats.blockers.count}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <ProductionReadinessScore
            score={score ?? null}
            status={status}
            label={scoreLabel}
            size="secondary"
            className="mt-6"
          />
        )}

        {why ? <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-xl">{why}</p> : null}

        {blocker ? (
          <RecommendedAction
            eyebrow={blocker.eyebrow}
            title={blocker.title}
            description={blocker.description}
          />
        ) : null}

        {children}

        {footerLink ? (
          <a
            href={footerLink.href}
            className="mt-6 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline seq-focus-ring rounded-sm"
          >
            {footerLink.label}
          </a>
        ) : null}
      </div>
    </IntelligenceSurface>
  );
}
