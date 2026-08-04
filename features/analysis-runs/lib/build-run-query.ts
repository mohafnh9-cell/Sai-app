/**
 * Preserve analysis run scope in Mission Control navigation URLs.
 * `run` maps to `scans.id` (AnalysisRunId).
 */
export function withAnalysisRunQuery(href: string, analysisRunId?: string | null): string {
  if (!analysisRunId) return href;

  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const [path, query = ""] = withoutHash.split("?");
  const params = new URLSearchParams(query);
  params.set("run", analysisRunId);
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}${hash}`;
}

export function appendAnalysisRunSearchParams(
  params: URLSearchParams,
  analysisRunId?: string | null
): URLSearchParams {
  if (analysisRunId) {
    params.set("run", analysisRunId);
  }
  return params;
}
