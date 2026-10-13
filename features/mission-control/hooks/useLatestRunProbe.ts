"use client";

import { useQuery } from "@tanstack/react-query";
import type { RunBrief } from "../lib/run-context";

/** How often an idle page checks (read-only) whether a newer analysis exists. Paused while the tab is hidden. */
export const LATEST_RUN_PROBE_INTERVAL_MS = 60_000;

type ProbeRun = { runId: string; commitSha: string | null; createdAt: string; status: string };

/**
 * Notices an analysis started elsewhere (a push, another person) while this page sits idle. It only READS the newest run
 * (`GET /api/projects/{id}/analysis-runs?limit=1`) and never feeds the page's own state: what the page shows does not change by itself;
 * the person is told and chooses. Silent when the endpoint is unavailable (feature off, rate limit, network).
 */
export function useLatestRunProbe(projectId: string): RunBrief | null {
  // The public demo has no real project to ask about.
  const inDemo = typeof window !== "undefined" && window.location.pathname.startsWith("/demo");
  const query = useQuery({
    enabled: !inDemo,
    queryKey: ["latest-run-probe", projectId],
    queryFn: async (): Promise<RunBrief | null> => {
      const response = await fetch(`/api/projects/${projectId}/analysis-runs?limit=1`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return null;
      const body = (await response.json().catch(() => null)) as { runs?: ProbeRun[] } | null;
      const run = body?.runs?.[0];
      return run ? { runId: run.runId, commitSha: run.commitSha, createdAt: run.createdAt, status: run.status } : null;
    },
    refetchInterval: LATEST_RUN_PROBE_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    // The page is server-rendered with its own latest run; the first probe is the one after the interval or on focus.
    staleTime: LATEST_RUN_PROBE_INTERVAL_MS,
    initialData: undefined,
  });
  return query.data ?? null;
}
