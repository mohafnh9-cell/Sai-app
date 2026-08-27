"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProtectionCenterSnapshot } from "../types";

async function toggleContinuousProtection(
  projectId: string,
  enabled: boolean
): Promise<ProtectionCenterSnapshot | null> {
  const response = await fetch(`/api/projects/${projectId}/protection-center`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error("Could not update continuous protection");
  }
  const body = (await response.json()) as { protectionCenter?: ProtectionCenterSnapshot | null };
  return body.protectionCenter ?? null;
}

export function useToggleContinuousProtection(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (enabled: boolean) => toggleContinuousProtection(projectId, enabled),
    onSuccess: (model) => {
      queryClient.setQueryData(["protection-center", projectId], model);
    },
  });
}
