/** Canonical project home — Production Verdict (Mission Control). */
export function projectVerdictHref(
  projectId: string,
  query?: Record<string, string | undefined>
): string {
  const base = `/projects/${projectId}/mission-control`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
