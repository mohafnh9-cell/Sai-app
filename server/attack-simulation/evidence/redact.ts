const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9\-._]{8,}/gi,
  /password["']?\s*[:=]\s*["'][^"']+["']/gi,
  /"password"\s*:\s*"[^"]+"/gi,
  /"token"\s*:\s*"[^"]+"/gi,
  /"secret"\s*:\s*"[^"]+"/gi,
  /session["']?\s*[:=]\s*["'][^"']+["']/gi,
  /sk-[A-Za-z0-9]{10,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "password",
  "secret",
  "api_key",
  "apikey",
  "authorization",
]);

export function redactAttackSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function redactAttackUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return redactAttackSecrets(parsed.toString());
  } catch {
    return redactAttackSecrets(url);
  }
}

export function redactAttackJson(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactAttackSecrets(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redactAttackJson(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactAttackJson(nested);
      }
    }
    return out;
  }
  return String(value);
}

export function redactAttackRecord(value: Record<string, unknown>): Record<string, unknown> {
  return redactAttackJson(value) as Record<string, unknown>;
}

export function redactAttackRecords(values: Record<string, unknown>[]): Record<string, unknown>[] {
  return values.map((value) => redactAttackRecord(value));
}
