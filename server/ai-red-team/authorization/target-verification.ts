import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { resolveTxt, lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizeOrigin } from "./types";

export type ManualVerificationMethod = "http" | "dns";
export type AutomaticVerificationMethod =
  | "provider_integration"
  | "deployment_repository_match";
export type VerificationMethod = ManualVerificationMethod | AutomaticVerificationMethod;

export type TargetVerificationRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  targetOrigin: string;
  verificationToken: string;
  verificationMethod: VerificationMethod;
  status: "pending" | "verified" | "expired";
  createdBy: string | null;
  expiresAt: string;
  verifiedAt: string | null;
  verificationEvidence: Record<string, unknown>;
};

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const HTTP_FETCH_TIMEOUT_MS = 8_000;

export function generateVerificationToken(input: {
  organizationId: string;
  projectId: string;
  targetOrigin: string;
}): string {
  const entropy = randomBytes(16).toString("hex");
  const digest = createHash("sha256")
    .update(`${input.organizationId}:${input.projectId}:${input.targetOrigin}:${entropy}`)
    .digest("hex")
    .slice(0, 32);
  return `sequrai-verify-${digest}`;
}

export function normalizeAllowedPaths(paths: string[] | undefined): string[] {
  const defaults = ["/api", "/login", "/health", "/auth"];
  const source = paths && paths.length > 0 ? paths : defaults;
  return normalizeExplicitAllowedPaths(source);
}

export function normalizeExplicitAllowedPaths(paths: string[]): string[] {
  const normalized = paths
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const withoutWildcard = entry.endsWith("/*") ? entry.slice(0, -2) : entry;
      return withoutWildcard.startsWith("/") ? withoutWildcard : `/${withoutWildcard}`;
    });
  return [...new Set(normalized)];
}

/** Union of existing approved scope and audit-required paths — never injects global fallbacks. */
export function mergeMinimalAllowedPaths(existingPaths: string[], requiredPaths: string[]): string[] {
  return normalizeExplicitAllowedPaths([...existingPaths, ...requiredPaths]);
}

// M4 (audit): the previous check only string-matched the hostname and
// missed 172.16.0.0/12 and all of IPv6. It's kept as a fast, cheap
// pre-filter for obvious cases (and for hostnames that are literal IPs),
// but the real defense is isBlockedIpAddress below, applied to the
// hostname's actual RESOLVED address -- a public-looking hostname that
// resolves to an internal IP is exactly what a hostname-only check misses.
export function isBlockedVerificationHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.includes("metadata")) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isBlockedIpv4(host);
  if (ipVersion === 6) return isBlockedIpv6(host);
  return false;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Not a clean dotted-quad -- treat anything we can't parse confidently
    // as blocked rather than silently letting it through (e.g. leading
    // zeros / decimal / octal / hex obfuscation like 0x7f000001).
    return true;
  }
  const [a, b] = parts;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true; // unspecified
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9")) return true; // fe80::/10-ish link-local (fe8/fe9 first hextet)
  if (normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 unique local
  // IPv4-mapped/compatible IPv6 (::ffff:127.0.0.1, ::127.0.0.1) -- check the
  // embedded v4 address too, since that's a common bypass shape.
  const mappedV4 = normalized.match(/(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedV4 && isBlockedIpv4(mappedV4[1])) return true;
  return false;
}

function isBlockedIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true; // couldn't parse as an IP at all -- fail closed
}

/**
 * The real SSRF defense: resolve the hostname via DNS ourselves and
 * validate every resolved address, not just the hostname string. Closes
 * the gap where a public-looking hostname resolves to an internal IP.
 *
 * Residual risk (documented, not silently claimed away): this validates
 * the address at check-time. fetch()'s own DNS resolution happens
 * separately at request-time, so a sub-second DNS-rebinding attack that
 * changes the answer between this check and the fetch call is not fully
 * eliminated by a pre-check alone -- fully closing that requires pinning
 * the resolved IP into the fetch itself (a custom dispatcher), which is
 * a larger change than this pass makes. This still closes the concrete,
 * static bypass the audit found (a hostname that simply resolves to a
 * private IP), which is the far more common real-world case.
 */
export async function assertHostnameResolvesToPublicAddress(
  hostname: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ipVersion = isIP(hostname);
  if (ipVersion) {
    return isBlockedIpAddress(hostname) ? { ok: false, reason: "blocked_ip" } : { ok: true };
  }

  try {
    const results = await dnsLookup(hostname, { all: true });
    if (results.length === 0) return { ok: false, reason: "dns_no_results" };
    for (const result of results) {
      if (isBlockedIpAddress(result.address)) {
        return { ok: false, reason: "resolved_to_blocked_ip" };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "dns_lookup_failed" };
  }
}

export function buildHttpVerificationInstructions(origin: string, token: string) {
  const url = new URL(origin);
  return {
    method: "http" as const,
    path: "/.well-known/sequrai-verification.txt",
    url: `${url.origin}/.well-known/sequrai-verification.txt`,
    expectedContent: token,
    instructions:
      `Create a plain-text file at /.well-known/sequrai-verification.txt containing exactly:\n${token}`,
  };
}

export function buildDnsVerificationInstructions(origin: string, token: string) {
  const hostname = new URL(origin).hostname;
  return {
    method: "dns" as const,
    recordName: `_sequrai-verify.${hostname}`,
    expectedValue: `sequrai-verify=${token}`,
    instructions:
      `Add a DNS TXT record:\nHost: _sequrai-verify.${hostname}\nValue: sequrai-verify=${token}`,
  };
}

export function verificationExpiryIso(nowMs = Date.now()): string {
  return new Date(nowMs + VERIFICATION_TTL_MS).toISOString();
}

export async function verifyTargetOwnershipHttp(
  targetOrigin: string,
  token: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let origin: string;
  try {
    origin = normalizeOrigin(targetOrigin);
  } catch {
    return { ok: false, reason: "invalid_origin" };
  }

  const hostname = new URL(origin).hostname;
  if (isBlockedVerificationHostname(hostname)) {
    return { ok: false, reason: "blocked_hostname" };
  }
  const resolved = await assertHostnameResolvesToPublicAddress(hostname);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  const verificationUrl = `${origin}/.well-known/sequrai-verification.txt`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(verificationUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "text/plain,*/*" },
    });
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, reason: `http_status_${response.status}` };
    }
    const body = (await response.text()).trim();
    if (body !== token) {
      return { ok: false, reason: "token_mismatch" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "http_fetch_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyTargetOwnershipDns(
  targetOrigin: string,
  token: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let origin: string;
  try {
    origin = normalizeOrigin(targetOrigin);
  } catch {
    return { ok: false, reason: "invalid_origin" };
  }

  const hostname = new URL(origin).hostname;
  if (isBlockedVerificationHostname(hostname)) {
    return { ok: false, reason: "blocked_hostname" };
  }
  const resolved = await assertHostnameResolvesToPublicAddress(hostname);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  const recordName = `_sequrai-verify.${hostname}`;
  const expected = `sequrai-verify=${token}`;

  try {
    const records = await resolveTxt(recordName);
    const flat = records.flat().map((entry) => entry.trim());
    if (flat.includes(expected)) {
      return { ok: true };
    }
    return { ok: false, reason: "dns_token_mismatch" };
  } catch {
    return { ok: false, reason: "dns_lookup_failed" };
  }
}

export function mapVerificationRow(row: Record<string, unknown>): TargetVerificationRecord {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    targetOrigin: row.target_origin as string,
    verificationToken: row.verification_token as string,
    verificationMethod: row.verification_method as VerificationMethod,
    status: row.status as TargetVerificationRecord["status"],
    createdBy: (row.created_by as string | null) ?? null,
    expiresAt: row.expires_at as string,
    verifiedAt: (row.verified_at as string | null) ?? null,
    verificationEvidence:
      (row.verification_evidence as Record<string, unknown> | null) ?? {},
  };
}
