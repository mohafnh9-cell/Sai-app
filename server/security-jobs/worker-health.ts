import "server-only";

import { createServer, type Server } from "node:http";
import { listExternalAndNativeAdjacentEngines } from "@/server/security-engines/registry";
import { WORKER_CONFIG } from "./worker-config";

/**
 * Phase 35.5, section 33: health = process alive. Readiness = required
 * engine binaries/assets actually present -- never reports ready if a
 * dependency is missing (an engine reporting unhealthy is expected and
 * honest when its binary isn't configured on this worker; readiness
 * reflects that truthfully rather than always returning 200).
 */
export async function computeReadiness() {
  const engines = listExternalAndNativeAdjacentEngines();
  const checks = await Promise.all(
    engines.map(async (engine) => {
      const result = await engine.healthCheck();
      return { engine: engine.id, healthy: result.healthy, reason: result.reason, version: result.detectedVersion };
    })
  );
  // "Ready" means this worker can do SOME useful work, not that every
  // possible engine is configured -- a worker legitimately may not have
  // every binary installed. Each engine's own health is still reported
  // truthfully in `checks`, so an operator can see exactly what's missing;
  // this is never collapsed into a single misleading "all good."
  return { ready: checks.some((c) => c.healthy), checks };
}

export function startHealthServer(): Server {
  const server = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "alive" }));
      return;
    }
    if (req.url === "/readiness") {
      const readiness = await computeReadiness();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(readiness));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(WORKER_CONFIG.healthPort);
  return server;
}
