export type DiscoveryLogEvent =
  | "discovery_started"
  | "repository_analyzed"
  | "technologies_detected"
  | "technology_graph_generated"
  | "attack_surface_generated"
  | "discovery_completed"
  | "discovery_failed"
  | "discovery_cache_hit";

export type DiscoveryLogger = {
  log: (entry: {
    event: DiscoveryLogEvent;
    projectId?: string;
    commitSha?: string;
    durationMs?: number;
    error?: string;
    metadata?: Record<string, unknown>;
  }) => void;
};

export function createDiscoveryLogger(sink?: (payload: Record<string, unknown>) => void): DiscoveryLogger {
  const write = sink ?? ((payload: Record<string, unknown>) => console.info({ component: "discovery-engine", ...payload }));
  return {
    log(entry) {
      write({
        timestamp: new Date().toISOString(),
        ...entry,
      });
    },
  };
}
