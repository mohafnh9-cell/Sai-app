const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /"password"\s*:\s*"[^"]+"/gi,
  /"token"\s*:\s*"[^"]+"/gi,
  /sk-[A-Za-z0-9]{10,}/g,
];

export function redactApiBody(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}
