"use client";

import { Badge } from "@/components/ui/badge";
import { severityBadgeClass, normalizeSeverity } from "@/lib/design-system/severity";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

type SecuritySeverityBadgeProps = {
  severity?: string | null;
  label?: string;
  className?: string;
};

export function SecuritySeverityBadge({ severity, label, className }: SecuritySeverityBadgeProps) {
  const { t: tr } = useI18n("readiness");
  const normalized = normalizeSeverity(severity);
  const display =
    label ??
    (normalized
      ? tr(`severity.${normalized.toLowerCase() as "critical" | "high" | "medium" | "low" | "info"}`)
      : severity ?? "—");

  return (
    <Badge variant="outline" className={cn(severityBadgeClass(severity), className)}>
      {display}
    </Badge>
  );
}
