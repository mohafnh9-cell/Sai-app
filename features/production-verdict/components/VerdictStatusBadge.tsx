"use client";

import { Badge } from "@/components/ui/badge";
import { verdictBadgeVariant } from "@/brain/production-verdict/status-ui";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { useI18n } from "@/lib/i18n/client";
import { verdictStatusLabel } from "@/lib/i18n/verdict-copy";

export function VerdictStatusBadge({
  status,
  affirms,
  className,
}: {
  status: VerdictStatus;
  /** Result of `verdictAffirmsDeploy(verdict)`; without it a ready_to_ship status gets the evidence-limited label. */
  affirms?: boolean | null;
  className?: string;
}) {
  const { t } = useI18n();
  const { t: tv } = useI18n("verdict");
  const label = verdictStatusLabel(status, (key, params) => t(key, params), affirms);

  return (
    <Badge
      variant={verdictBadgeVariant(status === "ready_to_ship" && affirms !== true ? "almost_ready" : status)}
      className={className}
      aria-label={tv("badgeAriaLabel", { status: label })}
    >
      {label}
    </Badge>
  );
}
