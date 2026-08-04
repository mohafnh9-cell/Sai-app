"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { analysisRunKeys } from "../lib/query-keys";

type StartAnalysisRunResponse = {
  ok?: boolean;
  runId?: string | null;
  scanId?: string;
  missionControlHref?: string | null;
  attackCenterHref?: string | null;
  error?: string;
  code?: string;
  needsReauth?: boolean;
  scan?: { id?: string };
};

export function useStartAnalysisRun(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input?: { forceNew?: boolean; branch?: string }) => {
      const response = await fetch(`/api/projects/${projectId}/analysis-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          forceNew: input?.forceNew ?? true,
          ...(input?.branch ? { branch: input.branch } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as StartAnalysisRunResponse;
      if (!response.ok || body.ok === false) {
        throw Object.assign(new Error(body.error ?? "Failed to start analysis run"), {
          code: body.code,
          needsReauth: body.needsReauth,
          status: response.status,
          body,
        });
      }
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: analysisRunKeys.list(projectId) });
    },
  });
}
