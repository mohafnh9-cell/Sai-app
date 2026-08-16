import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashOAuthSecret(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateOAuthSecret(prefix: string): string {
  return `${prefix}${randomBytes(24).toString("hex")}`;
}

export function generateAuthorizationCode(): string {
  return randomBytes(32).toString("base64url");
}

export function safeCompareHashes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
