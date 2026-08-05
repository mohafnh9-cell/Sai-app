"use client";

import { AnalyzeProjectScanContainer } from "@/features/projects/components/AnalyzeProjectScanContainer";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";

export function RunSecurityScanButton({
  projectId,
  disabled,
  initialContext,
}: {
  projectId: string;
  disabled?: boolean;
  initialContext: ProjectReviewUiContext;
}) {
  return (
    <AnalyzeProjectScanContainer
      projectId={projectId}
      initialContext={initialContext}
      size="sm"
      className={disabled ? "pointer-events-none opacity-50" : undefined}
    />
  );
}
