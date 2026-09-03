"use client";

import { Badge } from "@/components/ui/badge";
import {
  verificationBadgeClass,
  normalizeVerificationStatus,
  type VerificationStatus,
} from "@/lib/design-system/verification";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

type VerificationStatusBadgeProps = {
  status?: VerificationStatus | string | null;
  className?: string;
};

export function VerificationStatusBadge({ status, className }: VerificationStatusBadgeProps) {
  const { t } = useI18n("technicalDetails");
  const normalized = normalizeVerificationStatus(status ?? null);
  if (!normalized) return null;

  const labelKey = `verification.${normalized.toLowerCase()}` as const;
  const label = t(labelKey);

  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 py-0 text-[10px] font-medium",
        verificationBadgeClass(normalized),
        className
      )}
      aria-label={t("verification.ariaLabel", { status: label })}
    >
      {label}
    </Badge>
  );
}
