"use client";

import { useQuery } from "@tanstack/react-query";
import type { SecurityTestContext } from "@/features/security-testing/types";
import { TERMINAL_DISPLAY_PHASES } from "@/features/security-testing/lib/derive-phase";
import { analysisRunKeys } from "../lib/query-keys";
import { appendAnalysisRunSearchParams } from "../lib/build-run-query";

const POLL_INTERVAL_MS = 5000;

type SecurityTestsResponse = SecurityTestContext & {
  ok?: boolean;
  error?: string;
};

function shouldPollSecurityTests(context: SecurityTestContext | undefined): boolean {
  if (!context) return false;
  if (TERMINAL_DISPLAY_PHASES.has(context.phase)) return false;
  return (
    context.reviewInProgress ||
    context.phase === "preparing" ||
    context.phase === "running" ||
    context.phase === "issues_found" ||
    context.phase === "fix_ready"
  );
}

export function useSecurityTestContext(
  projectId: string,
  options?: {
    analysisRunId?: string | null;
    initialData?: SecurityTestContext | null;
    enabled?: boolean;
  }
) {
  const analysisRunId = options?.analysisRunId ?? null;

  return useQuery({
    queryKey: analysisRunKeys.securityTests(projectId, analysisRunId),
    queryFn: async () => {
      const params = new URLSearchParams();
      appendAnalysisRunSearchParams(params, analysisRunId);
      const qs = params.toString();
      const response = await fetch(
        `/api/projects/${projectId}/security-tests${qs ? `?${qs}` : ""}`,
        { cache: "no-store", credentials: "same-origin" }
      );
      const body = (await response.json().catch(() => ({}))) as SecurityTestsResponse;
      if (!response.ok || body.ok === false) {
        throw new Error(body.error ?? "Failed to load security test context");
      }
      const { ok: _ok, error: _error, ...context } = body;
      return context as SecurityTestContext;
    },
    initialData: options?.initialData ?? undefined,
    enabled: options?.enabled ?? !!projectId,
    refetchInterval: (query) =>
      shouldPollSecurityTests(query.state.data) ? POLL_INTERVAL_MS : false,
  });
}
