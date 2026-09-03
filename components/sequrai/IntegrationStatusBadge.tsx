"use client";

import { Badge } from "@/components/ui/badge";
import { integrationStatusClass, type IntegrationConnectionState } from "@/lib/design-system/integration";
import { cn } from "@/lib/utils";

export function IntegrationStatusBadge({
  status,
  label,
}: {
  status: IntegrationConnectionState;
  label: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(integrationStatusClass(status), "text-[11px] uppercase tracking-wide")}
    >
      {label}
    </Badge>
  );
}
