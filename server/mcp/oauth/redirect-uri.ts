import "server-only";

import { OAuthError } from "./errors";

const BLOCKED_SCHEMES = new Set(["javascript", "data", "file", "vbscript"]);

export type ParsedRedirectUri = {
  scheme: string;
  host: string;
  port: string;
  pathname: string;
  normalized: string;
};

export function parseRedirectUri(raw: string): ParsedRedirectUri | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) return null;

  const host = url.hostname.toLowerCase();
  const port = url.port;
  const pathname = url.pathname || "/";
  const normalized = `${scheme}://${host}${port ? `:${port}` : ""}${pathname}`;

  return { scheme, host, port, pathname, normalized };
}

export function isLocalhostHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function isAllowedRedirectScheme(scheme: string, host: string): boolean {
  if (scheme === "https") return true;
  if (scheme === "http" && isLocalhostHost(host)) return true;
  // Custom schemes for documented MCP desktop clients (exact match still required).
  if (scheme === "claude" || scheme === "cursor") return true;
  return false;
}

export function normalizeRegisteredRedirectUri(raw: string): string | null {
  const parsed = parseRedirectUri(raw);
  if (!parsed) return null;
  if (!isAllowedRedirectScheme(parsed.scheme, parsed.host)) return null;
  return parsed.normalized;
}

/**
 * Exact match on scheme, host, port, and path.
 * No wildcard, substring, startsWith, or contains matching.
 */
export function redirectUriExactMatch(requested: string, registered: string[]): boolean {
  const normalizedRequested = normalizeRegisteredRedirectUri(requested);
  if (!normalizedRequested) return false;

  for (const candidate of registered) {
    const normalizedRegistered = normalizeRegisteredRedirectUri(candidate);
    if (normalizedRegistered && normalizedRegistered === normalizedRequested) {
      return true;
    }
  }
  return false;
}

export function assertRedirectUriAllowed(requested: string, registered: string[]): void {
  if (!requested) {
    throw new OAuthError("invalid_request", "redirect_uri is required");
  }
  if (!redirectUriExactMatch(requested, registered)) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uri is not registered for this client");
  }
}
