import type { DiscoveryEngineInput, DiscoveryReport } from "./types";
import type { DiscoveryLogger } from "./logging/discovery-logger";
import { createDiscoveryLogger } from "./logging/discovery-logger";
import { assembleDiscoveryReport } from "./report/assemble-discovery-report";
import { getCachedDiscoveryReport, setCachedDiscoveryReport } from "./cache/discovery-cache";

export type DiscoveryEngineOptions = {
  logger?: DiscoveryLogger;
};

export class DiscoveryEngine {
  private readonly logger: DiscoveryLogger;

  constructor(options?: DiscoveryEngineOptions) {
    this.logger = options?.logger ?? createDiscoveryLogger();
  }

  async discover(input: DiscoveryEngineInput): Promise<DiscoveryReport> {
    const started = Date.now();
    this.logger.log({
      event: "discovery_started",
      projectId: input.projectId,
      commitSha: input.commitSha,
    });

    try {
      if (!input.skipCache) {
        const cached = getCachedDiscoveryReport(input.projectId, input.commitSha);
        if (cached) {
          this.logger.log({
            event: "discovery_cache_hit",
            projectId: input.projectId,
            commitSha: input.commitSha,
            durationMs: Date.now() - started,
          });
          return { ...cached, cached: true };
        }
      }

      this.logger.log({
        event: "repository_analyzed",
        projectId: input.projectId,
        commitSha: input.commitSha,
        metadata: { fileCount: input.files.length },
      });

      const report = assembleDiscoveryReport({
        repository: input,
        durationMs: Date.now() - started,
        cached: false,
      });

      this.logger.log({
        event: "technologies_detected",
        projectId: input.projectId,
        metadata: {
          count: report.detectedTechnologies.length,
          technologies: report.detectedTechnologies.map((t) => t.id),
        },
      });

      this.logger.log({
        event: "technology_graph_generated",
        projectId: input.projectId,
        metadata: {
          nodes: report.technologyGraph.nodes.length,
          edges: report.technologyGraph.edges.length,
        },
      });

      this.logger.log({
        event: "attack_surface_generated",
        projectId: input.projectId,
        metadata: {
          areas: report.potentialAttackSurface.map((a) => a.area),
        },
      });

      if (!input.skipCache) {
        setCachedDiscoveryReport(input.projectId, input.commitSha, report);
      }

      this.logger.log({
        event: "discovery_completed",
        projectId: input.projectId,
        commitSha: input.commitSha,
        durationMs: report.durationMs,
        metadata: { confidenceScore: report.confidenceScore },
      });

      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log({
        event: "discovery_failed",
        projectId: input.projectId,
        commitSha: input.commitSha,
        error: message,
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }
}

export function createDiscoveryEngine(options?: DiscoveryEngineOptions): DiscoveryEngine {
  return new DiscoveryEngine(options);
}
