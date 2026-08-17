"use client";

import { PortfolioProjectRow } from "@/components/sequrai/PortfolioProjectRow";
import type { ProjectBrainSummary } from "@/brain";
import { useDemoNavigation } from "@/features/demo/use-demo-navigation";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

export function PortfolioVerdictCard({
  projectId,
  projectName,
  summary,
  needsAttention = false,
}: {
  projectId: string;
  projectName: string;
  summary: ProjectBrainSummary | undefined;
  needsAttention?: boolean;
}) {
  const { href } = useDemoNavigation();

  return (
    <PortfolioProjectRow
      projectId={projectId}
      projectName={projectName}
      summary={summary}
      href={href(projectVerdictHref(projectId))}
      needsAttention={needsAttention}
    />
  );
}
