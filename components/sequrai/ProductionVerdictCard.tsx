"use client";

import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { verdictToneClass } from "@/brain/production-verdict/status-ui";
import { IntelligenceSurface } from "./IntelligenceSurface";
import { ProductionReadinessScore } from "./ProductionReadinessScore";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { RecommendedAction } from "./RecommendedAction";
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

      <ProductionReadinessScore
        score={score ?? null}
        status={status}
        label={scoreLabel}
        size="secondary"
        className="mt-6"
      />

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
    </IntelligenceSurface>
  );
}
