"use client";

import { integrationStatusClasses, type IntegrationConnectionState } from "@/lib/design-system/integration";

export function IntegrationStatusBadge({
  status,
  label,
}: {
  status: IntegrationConnectionState;
  label: string;
}) {
  return <span className={integrationStatusClasses(status)}>{label}</span>;
}
