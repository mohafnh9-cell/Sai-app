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

export function isSubscriptionRequired(body: ScanApiErrorBody | null | undefined): boolean {
  return body?.code === "SUBSCRIPTION_REQUIRED";
}

export function resolveScanErrorMessage(
  body: ScanApiErrorBody | null | undefined,
  fallbacks: {
    defaultMessage: string;
    rateLimited?: string;
    infrastructureMissing?: string;
    reauth?: string;
    subscriptionRequired?: string;
  }
): string {
  if (isSubscriptionRequired(body)) {
    return fallbacks.subscriptionRequired ?? body?.error ?? fallbacks.defaultMessage;
  }
  if (isGitHubReauthRequired(body)) {
    return fallbacks.reauth ?? body?.error ?? fallbacks.defaultMessage;
  }
  if (body?.code === "SCAN_RATE_LIMITED") {
    return fallbacks.rateLimited ?? body.error ?? fallbacks.defaultMessage;
  }
  if (body?.code === "SCAN_JOB_INFRASTRUCTURE_MISSING") {
    return fallbacks.infrastructureMissing ?? body.error ?? fallbacks.defaultMessage;
  }
  return body?.error ?? body?.message ?? fallbacks.defaultMessage;
}
