"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProtectionCenterSnapshot } from "../types";

const REFRESH_MS = 30_000;

async function fetchProtectionCenter(projectId: string): Promise<ProtectionCenterSnapshot | null> {
  const response = await fetch(`/api/projects/${projectId}/protection-center`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { protectionCenter?: ProtectionCenterSnapshot | null };
  return body.protectionCenter ?? null;
}

export function useProtectionCenter(
  projectId: string,
  initialData: ProtectionCenterSnapshot | null = null,
  enabled = true
) {
  return useQuery({
    queryKey: ["protection-center", projectId],
    queryFn: () => fetchProtectionCenter(projectId),
    initialData: initialData ?? undefined,
    enabled,
    staleTime: REFRESH_MS,
    refetchInterval: enabled ? REFRESH_MS : false,
  });
}