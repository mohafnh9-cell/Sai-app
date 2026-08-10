import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
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
  const normalized = source
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const withoutWildcard = entry.endsWith("/*") ? entry.slice(0, -2) : entry;
      return withoutWildcard.startsWith("/") ? withoutWildcard : `/${withoutWildcard}`;
    });
  return [...new Set(normalized)];
}

export function isBlockedVerificationHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host) || host === "0.0.0.0") return true;
  if (host.includes("metadata")) return true;
  return false;
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
