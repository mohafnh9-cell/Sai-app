import { createHash } from "node:crypto";

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9\-._]{8,}/gi,
  /password["']?\s*[:=]\s*["'][^"']+["']/gi,
  /session["']?\s*[:=]\s*["'][^"']+["']/gi,
  /sk-[A-Za-z0-9]{10,}/g,
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const json = redactSecrets(JSON.stringify(value));
  return JSON.parse(json) as Record<string, unknown>;
}

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
