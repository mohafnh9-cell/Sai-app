export type ScanSchedulerMode = "inline" | "inngest";

const VALID_MODES: ScanSchedulerMode[] = ["inline", "inngest"];

export function getScanSchedulerMode(): ScanSchedulerMode {
  const raw = process.env.SCAN_SCHEDULER?.trim().toLowerCase();
  if (raw && VALID_MODES.includes(raw as ScanSchedulerMode)) {
    return raw as ScanSchedulerMode;
  }
  return "inline";
}

export function isInngestSchedulerEnabled(): boolean {
  return getScanSchedulerMode() === "inngest";
}

export function isInngestEnabledForOrganization(organizationId: string): boolean {
  if (!isInngestSchedulerEnabled()) return false;
  const allowlist = process.env.INNGEST_ASYNC_ORG_ALLOWLIST?.trim();
  if (!allowlist) return true;
  const allowed = allowlist.split(",").map((id) => id.trim()).filter(Boolean);
  return allowed.includes(organizationId);
}

export function assertInngestSchedulerConfigured(): void {
  if (!isInngestSchedulerEnabled()) return;
  if (!process.env.INNGEST_EVENT_KEY?.trim()) {
    throw new Error("INNGEST_EVENT_KEY is required when SCAN_SCHEDULER=inngest");
  }
}
