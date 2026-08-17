import { PortfolioProjectRow } from "@/components/sequrai/PortfolioProjectRow";
import type { ProjectBrainSummary } from "@/brain";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { ProjectRow } from "@/types/database";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

interface ProjectCardProps {
  project: ProjectRow;
  summary?: ProjectBrainSummary;
  verdictStatus?: VerdictStatus;
  needsAttention?: boolean;
  detailHref?: string;
}

export function ProjectCard({
  project,
  summary,
  verdictStatus,
  needsAttention,
  detailHref,
}: ProjectCardProps) {
  return (
    <PortfolioProjectRow
      projectId={project.id}
      projectName={project.name}
      githubRepo={project.github_repo}
      summary={summary}
      verdictStatus={verdictStatus}
      lastScanAt={project.last_scan_at}
      href={detailHref ?? projectVerdictHref(project.id)}
      needsAttention={needsAttention}
    />
  );
}
