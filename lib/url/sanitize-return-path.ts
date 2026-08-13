/** Allow only same-app relative paths for post-checkout redirects. */
export function sanitizeReturnPath(value: string | null | undefined): string {
  if (!value) return "/dashboard";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/dashboard";
  return trimmed;
}

export function appendQueryParam(path: string, key: string, value: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(value)}`;
}
