"use client";

import { Badge } from "@/components/ui/badge";
import type { ConfidenceLevel } from "@/brain/confidence/types";
import { confidenceBadgeClass } from "@/lib/design-system/confidence";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

type ConfidenceLevelBadgeProps = {
  level?: ConfidenceLevel | null;
  className?: string;
};

export function ConfidenceLevelBadge({ level, className }: ConfidenceLevelBadgeProps) {
  const { t } = useI18n("technicalDetails");
  if (!level) return null;

  const labelKey = `confidenceLevels.${level.toLowerCase()}` as const;
  const label = t(labelKey);

  return (
    <Badge
      variant="outline"
      className={cn(confidenceBadgeClass(level), className)}
      aria-label={t("confidenceLevels.ariaLabel", { level: label })}
    >
      {label}
    </Badge>
  );
}
