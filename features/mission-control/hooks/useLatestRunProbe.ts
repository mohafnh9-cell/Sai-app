"use client";

import { useState } from "react";
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { RunBrief } from "../lib/run-context";

/** How often an idle page checks (read-only) whether a newer analysis exists. Paused while the tab is hidden. */
export const LATEST_RUN_PROBE_INTERVAL_MS = 60_000;

type ProbeRun = { runId: string; commitSha: string | null; createdAt: string; status: string };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Query options of the idle probe (exported so tests exercise exactly what runs).
 *
 * Read-only by construction: ONE `GET /api/projects/{id}/analysis-runs?limit=1&verdicts=0` (scans row only: no verdict JSON, no
 * writes, no alerts, no repair). It never feeds the page's own state. It is seeded with the newest run the server already rendered,
 * so there is no request at load; the first one is 60 s later, only while the tab is visible, and again when the tab returns to the
 * foreground if the data is older than that. Silent when the endpoint is unavailable (feature off, rate limit, network).
 */
export function latestRunProbeOptions(
  projectId: string,
  initial: RunBrief | null,
  initialUpdatedAt: number,
  fetchImpl: FetchLike = (input, init) => fetch(input, init)
): UseQueryOptions<RunBrief | null> {
  return {
    queryKey: ["latest-run-probe", projectId],
    queryFn: async (): Promise<RunBrief | null> => {
      const response = await fetchImpl(`/api/projects/${projectId}/analysis-runs?limit=1&verdicts=0`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return null;
      const body = (await response.json().catch(() => null)) as { runs?: ProbeRun[] } | null;
      const run = body?.runs?.[0];
      return run ? { runId: run.runId, commitSha: run.commitSha, createdAt: run.createdAt, status: run.status } : null;
    },
    refetchInterval: LATEST_RUN_PROBE_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: false,
    retry: false,
    staleTime: LATEST_RUN_PROBE_INTERVAL_MS,
    ...(initial ? { initialData: initial, initialDataUpdatedAt: initialUpdatedAt } : {}),
  };
}

/** Notices an analysis started elsewhere (a push, another person) while this page sits idle. See `latestRunProbeOptions`. */
export function useLatestRunProbe(projectId: string, initial: RunBrief | null): RunBrief | null {
  // The public demo has no real project to ask about.
  const inDemo = typeof window !== "undefined" && window.location.pathname.startsWith("/demo");
  const [seed] = useState(() => ({ initial, at: Date.now() }));
  const query = useQuery({ ...latestRunProbeOptions(projectId, seed.initial, seed.at), enabled: !inDemo });
  return query.data ?? null;
}
