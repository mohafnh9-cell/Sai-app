"use client";

import { useQuery } from "@tanstack/react-query";
import type { AnalysisRunListItem } from "@/server/analysis-runs/list-analysis-runs";
import { analysisRunKeys } from "../lib/query-keys";

type AnalysisRunsResponse = {
  ok?: boolean;
  runs?: AnalysisRunListItem[];
  error?: string;
};

export function useAnalysisRuns(
  projectId: string,
  options?: { initialRuns?: AnalysisRunListItem[]; enabled?: boolean }
) {
  return useQuery({
    queryKey: analysisRunKeys.list(projectId),
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/analysis-runs`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => ({}))) as AnalysisRunsResponse;
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to load analysis runs");
      }
      return body.runs ?? [];
    },
    initialData: options?.initialRuns,
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}
