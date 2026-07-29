export type ScanSchedulerMode = "inline" | "inngest";

export type ScanExecutorKind = "inngest" | "inline";

export type ScanSchedulerPlan =
  | {
      ok: true;
      configuredMode: ScanSchedulerMode;
      executor: ScanExecutorKind;
      organizationId: string;
      allowlistApplied: boolean;
      orgFallbackUsed: boolean;
      userReviewInline?: boolean;
    }
  | {
      ok: false;
      code:
        | "INVALID_SCAN_SCHEDULER"
        | "INGEST_NOT_CONFIGURED"
        | "ORG_NOT_IN_INGEST_ALLOWLIST";
      message: string;
      configuredMode: ScanSchedulerMode | null;
      organizationId: string;
    };

export type ScanOrgFallbackMode = "inline" | "error";

export function isUserTriggeredProductionReview(jobType?: string | null): boolean {
  return jobType === "manual_scan" || jobType === "mcp_review";
}

export function getScanOrgFallbackMode(): ScanOrgFallbackMode {
  const raw = process.env.SCAN_SCHEDULER_ORG_FALLBACK?.trim().toLowerCase();
  if (raw === "inline") return "inline";
  return "error";
}

export function parseConfiguredScanSchedulerMode(): {
  mode: ScanSchedulerMode | null;
  invalidRaw: string | null;
} {
  const raw = process.env.SCAN_SCHEDULER?.trim().toLowerCase();
  if (!raw) return { mode: "inline", invalidRaw: null };
  if (raw === "inline" || raw === "inngest") return { mode: raw, invalidRaw: null };
  return { mode: null, invalidRaw: raw };
}

export function assertProductionScanSchedulerConfiguration(): void {
  if (process.env.NODE_ENV !== "production") return;
  const { mode, invalidRaw } = parseConfiguredScanSchedulerMode();
  if (invalidRaw) {
    throw new Error(`Invalid SCAN_SCHEDULER="${invalidRaw}". Use inline or inngest.`);
  }
  if (mode === "inngest") {
    if (!process.env.INNGEST_EVENT_KEY?.trim()) {
      throw new Error("INNGEST_EVENT_KEY is required when SCAN_SCHEDULER=inngest");
    }
    if (!process.env.INNGEST_SIGNING_KEY?.trim()) {
      throw new Error("INNGEST_SIGNING_KEY is required in production when SCAN_SCHEDULER=inngest");
    }
  }
}

export function shouldForceInlineUserReview(): boolean {
  return process.env.SCAN_USER_REVIEW_FORCE_INLINE === "1";
}

export function resolveScanSchedulerPlan(
  organizationId: string,
  options?: { preferInlineExecutor?: boolean }
): ScanSchedulerPlan {
  const { mode, invalidRaw } = parseConfiguredScanSchedulerMode();

  const preferInline =
    options?.preferInlineExecutor ?? shouldForceInlineUserReview();

  if (preferInline) {
    return {
      ok: true,
      configuredMode: mode ?? "inline",
      executor: "inline",
      organizationId,
      allowlistApplied: false,
      orgFallbackUsed: false,
      userReviewInline: true,
    };
  }

  if (!mode) {
    return {
      ok: false,
      code: "INVALID_SCAN_SCHEDULER",
      message: `Invalid SCAN_SCHEDULER="${invalidRaw}". Use inline or inngest.`,
      configuredMode: null,
      organizationId,
    };
  }

  if (mode === "inline") {
    return {
      ok: true,
      configuredMode: "inline",
      executor: "inline",
      organizationId,
      allowlistApplied: false,
      orgFallbackUsed: false,
    };
  }

  if (!process.env.INNGEST_EVENT_KEY?.trim()) {
    return {
      ok: false,
      code: "INGEST_NOT_CONFIGURED",
      message: "INNGEST_EVENT_KEY is required when SCAN_SCHEDULER=inngest",
      configuredMode: "inngest",
      organizationId,
    };
  }

  const allowlist = process.env.INNGEST_ASYNC_ORG_ALLOWLIST?.trim();
  if (allowlist) {
    const allowed = allowlist.split(",").map((id) => id.trim()).filter(Boolean);
    if (!allowed.includes(organizationId)) {
      if (getScanOrgFallbackMode() === "inline") {
        return {
          ok: true,
          configuredMode: "inngest",
          executor: "inline",
          organizationId,
          allowlistApplied: true,
          orgFallbackUsed: true,
        };
      }
      return {
        ok: false,
        code: "ORG_NOT_IN_INGEST_ALLOWLIST",
        message:
          "Organization is not in INNGEST_ASYNC_ORG_ALLOWLIST. Set SCAN_SCHEDULER_ORG_FALLBACK=inline to run inline for excluded orgs.",
        configuredMode: "inngest",
        organizationId,
      };
    }
  }

  return {
    ok: true,
    configuredMode: "inngest",
    executor: "inngest",
    organizationId,
    allowlistApplied: Boolean(allowlist),
    orgFallbackUsed: false,
  };
}
