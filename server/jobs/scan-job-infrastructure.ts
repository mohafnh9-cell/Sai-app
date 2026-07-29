import "server-only";

import { isScanJobsInfrastructureMissing } from "./legacy-inline-scan-run";

export const SCAN_JOB_INFRASTRUCTURE_MISSING = "SCAN_JOB_INFRASTRUCTURE_MISSING";

export class ScanJobInfrastructureError extends Error {
  readonly code = SCAN_JOB_INFRASTRUCTURE_MISSING;
  readonly migrationRequired = true;

  constructor(
    message: string,
    readonly details: {
      organizationId: string;
      projectId: string;
      scanId: string;
      environment: string;
    }
  ) {
    super(message);
    this.name = "ScanJobInfrastructureError";
  }
}

export function isLegacyInlineScanFallbackAllowed(): boolean {
  if (process.env.ALLOW_LEGACY_INLINE_SCAN_FALLBACK === "1") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

export function assertScanJobsAvailableOrThrow(input: {
  error: unknown;
  organizationId: string;
  projectId: string;
  scanId: string;
}): void {
  if (!isScanJobsInfrastructureMissing(input.error)) {
    return;
  }

  console.error({
    component: "scan-job-infrastructure",
    event: "scan_job_infrastructure_missing",
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    migrationRequired: true,
  });

  if (!isLegacyInlineScanFallbackAllowed()) {
    throw new ScanJobInfrastructureError(
      "Production Reviews require scan_jobs infrastructure (migrations 020, 021, 041).",
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        scanId: input.scanId,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      }
    );
  }
}
