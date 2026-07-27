import "server-only";

import type { McpAuthContext } from "../auth";
import { McpError } from "../auth";
import type { McpTranslator } from "../i18n";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import { buildProjectReportUrl } from "../report-url";
import {
  createDiscoveryEngine,
  loadDiscoveryRepositoryFromProject,
} from "@/server/ai-red-team/discovery";
import type { DiscoveryReport } from "@/server/ai-red-team/discovery/types";
import { formatDiscoverApplicationResponse } from "../personality";

export type DiscoverApplicationInput = ProjectSelector & {
  branch?: string;
};

export type DiscoverApplicationResult = {
  mode: "application_discovery";
  project: { id: string; name: string; repositoryFullName: string | null };
  commitSha: string;
  confidenceScore: number;
  detectedTechnologyCount: number;
  attackSurfaceCount: number;
  cached: boolean;
  reportUrl: string | null;
  discovery: DiscoveryReport;
  summary: string;
};

export async function discoverApplication(
  ctx: McpAuthContext,
  input: DiscoverApplicationInput,
  t: McpTranslator
): Promise<DiscoverApplicationResult> {
  const project = await resolveMcpProject(ctx, input, t);
  if (!project.repositoryFullName) {
    throw new McpError(404, "repository_disconnected", t("errors.repository_disconnected"));
  }

  const engine = createDiscoveryEngine();
  let repository;
  try {
    repository = await loadDiscoveryRepositoryFromProject(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
      branch: input.branch,
    });
  } catch {
    throw new McpError(502, "discovery_failed", t("errors.discovery_failed"));
  }

  const discovery = await engine.discover(repository);

  const result: DiscoverApplicationResult = {
    mode: "application_discovery",
    project: {
      id: project.id,
      name: project.name,
      repositoryFullName: project.repositoryFullName,
    },
    commitSha: discovery.commitSha,
    confidenceScore: discovery.confidenceScore,
    detectedTechnologyCount: discovery.detectedTechnologies.length,
    attackSurfaceCount: discovery.potentialAttackSurface.length,
    cached: discovery.cached,
    reportUrl: buildProjectReportUrl(project.id),
    discovery,
    summary: formatDiscoverApplicationResponse(discovery, t),
  };

  return result;
}
