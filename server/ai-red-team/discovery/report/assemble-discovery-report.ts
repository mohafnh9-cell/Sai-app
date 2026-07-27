import { randomUUID } from "node:crypto";
import type { DetectedTechnology, DiscoveryReport, DiscoveryRepositoryInput } from "../types";
import {
  detectPackageManagers,
  detectTechnologies,
} from "../detectors/technology-detector";
import { buildTechnologyGraph } from "../graph/build-technology-graph";
import { buildAttackSurface } from "../surface/build-attack-surface";

function filterCategory(technologies: DetectedTechnology[], category: DetectedTechnology["category"]) {
  return technologies.filter((t) => t.category === category);
}

function computeConfidenceScore(technologies: DetectedTechnology[], fileCount: number): number {
  if (technologies.length === 0) return 0.2;
  const avg = technologies.reduce((sum, t) => sum + t.confidence, 0) / technologies.length;
  const coverageBoost = Math.min(0.15, technologies.length * 0.01);
  const fileBoost = fileCount > 0 ? Math.min(0.1, fileCount / 500) : 0;
  return Math.min(0.99, Number((avg * 0.75 + coverageBoost + fileBoost).toFixed(2)));
}

export function assembleDiscoveryReport(input: {
  repository: DiscoveryRepositoryInput;
  durationMs: number;
  cached?: boolean;
}): DiscoveryReport {
  const technologies = detectTechnologies(input.repository);
  const graph = buildTechnologyGraph(technologies);
  const attackSurface = buildAttackSurface(technologies, input.repository);
  const auth = technologies.filter((t) => t.category === "auth");
  const database = technologies.filter(
    (t) => t.category === "database" || t.id === "postgresql" || t.id === "mysql" || t.id === "sqlite"
  );
  const payments = filterCategory(technologies, "payments");
  const aiProviders = filterCategory(technologies, "ai");
  const infrastructure = technologies.filter((t) =>
    ["runtime", "ci", "integration"].includes(t.category)
  );
  const deployment = filterCategory(technologies, "deployment");
  const storage = filterCategory(technologies, "storage");
  const packageManagers = detectPackageManagers(input.repository);

  const frameworkNames = technologies
    .filter((t) => t.category === "framework" || t.category === "library")
    .slice(0, 3)
    .map((t) => t.name);

  const projectSummary =
    input.repository.repositoryLabel != null
      ? `${input.repository.repositoryLabel} @ ${input.repository.commitSha.slice(0, 7)} — detected ${technologies.length} technologies across ${input.repository.files.length} analyzed files.`
      : `Project ${input.repository.projectId} @ ${input.repository.commitSha.slice(0, 7)} — detected ${technologies.length} technologies.`;

  return {
    reportId: randomUUID(),
    projectId: input.repository.projectId,
    organizationId: input.repository.organizationId,
    commitSha: input.repository.commitSha,
    generatedAt: new Date().toISOString(),
    durationMs: input.durationMs,
    projectSummary,
    detectedTechnologies: technologies,
    authenticationProviders: auth,
    database,
    payments,
    aiProviders,
    infrastructure,
    deployment,
    storage,
    packageManagers,
    potentialAttackSurface: attackSurface,
    technologyGraph: graph,
    confidenceScore: computeConfidenceScore(technologies, input.repository.files.length),
    cached: input.cached ?? false,
  };
}
