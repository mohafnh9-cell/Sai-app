import type { ScanSchedulerMode } from "./scan-scheduler-plan";
import {
  assertProductionScanSchedulerConfiguration,
  parseConfiguredScanSchedulerMode,
  resolveScanSchedulerPlan,
} from "./scan-scheduler-plan";

export type { ScanSchedulerMode };

export function getScanSchedulerMode(): ScanSchedulerMode {
  const { mode, invalidRaw } = parseConfiguredScanSchedulerMode();
  if (invalidRaw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Invalid SCAN_SCHEDULER="${invalidRaw}". Use inline or inngest.`);
    }
    return "inline";
  }
  return mode ?? "inline";
}

export function isInngestSchedulerEnabled(): boolean {
  return getScanSchedulerMode() === "inngest";
}

export function isInngestEnabledForOrganization(organizationId: string): boolean {
  const plan = resolveScanSchedulerPlan(organizationId);
  return plan.ok && plan.executor === "inngest";
}

export function assertInngestSchedulerConfigured(): void {
  assertProductionScanSchedulerConfiguration();
  if (!isInngestSchedulerEnabled()) return;
  if (!process.env.INNGEST_EVENT_KEY?.trim()) {
    throw new Error("INNGEST_EVENT_KEY is required when SCAN_SCHEDULER=inngest");
  }
}

export { assertProductionScanSchedulerConfiguration, resolveScanSchedulerPlan };
