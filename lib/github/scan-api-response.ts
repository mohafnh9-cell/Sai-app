export type ScanApiErrorBody = {
  error?: string;
  message?: string;
  needsReauth?: boolean;
  code?: string;
};

export function isGitHubReauthRequired(body: ScanApiErrorBody | null | undefined): boolean {
  return Boolean(
    body?.needsReauth ||
      body?.code === "GITHUB_REAUTH_REQUIRED" ||
      body?.code === "GITHUB_TOKEN_UNAVAILABLE"
  );
}

export function resolveScanErrorMessage(
  body: ScanApiErrorBody | null | undefined,
  fallbacks: {
    defaultMessage: string;
    rateLimited?: string;
    infrastructureMissing?: string;
    reauth?: string;
  }
): string {
  if (isGitHubReauthRequired(body)) {
    return fallbacks.reauth ?? body?.error ?? fallbacks.defaultMessage;
  }
  if (body?.code === "SCAN_RATE_LIMITED") {
    return body.error ?? fallbacks.rateLimited ?? fallbacks.defaultMessage;
  }
  if (body?.code === "SCAN_JOB_INFRASTRUCTURE_MISSING") {
    return fallbacks.infrastructureMissing ?? body.error ?? fallbacks.defaultMessage;
  }
  return body?.error ?? body?.message ?? fallbacks.defaultMessage;
}
