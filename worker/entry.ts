/**
 * Phase 35.5: SequrAI Security Execution Worker entrypoint.
 *
 * This is a SEPARATE process from the Next.js/Vercel application -- it is
 * bundled by scripts/bundle-security-worker.mjs (esbuild, same pattern as
 * scripts/bundle-local-mcp.mjs) into a single Node-runnable file and run in
 * its own container (worker/Dockerfile), independent of Vercel's function
 * runtime and size limits. See worker/README.md for the full architecture
 * and local-development instructions.
 *
 * It never receives inbound requests from the public internet (see
 * worker/README.md, "Push vs. pull"): it authenticates to Supabase with its
 * own SUPABASE_SERVICE_ROLE_KEY, polls the security_jobs table for QUEUED
 * rows, and exposes only /health and /readiness locally for container
 * orchestration.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { createPollLoop } from "@/server/security-jobs/worker-poll-loop";
import { startHealthServer } from "@/server/security-jobs/worker-health";
import { WORKER_CONFIG } from "@/server/security-jobs/worker-config";
import { WORKER_LIFECYCLE_VERSION } from "@/server/security-jobs/engine-result-status";

async function main() {
  console.info({
    component: "security-worker",
    event: "starting",
    workerId: WORKER_CONFIG.workerId,
    lifecycleVersion: WORKER_LIFECYCLE_VERSION,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
  });

  const admin = createAdminClient();
  const healthServer = startHealthServer();
  const controller = new AbortController();
  const loop = createPollLoop(admin, { signal: controller.signal });

  const shutdown = (signal: string) => {
    console.info({ component: "security-worker", event: "shutting_down", signal });
    controller.abort();
    healthServer.close();
    // Give any in-flight job's cancellation race a moment to notice before
    // the process exits -- not a guarantee, but avoids an abrupt SIGKILL
    // being the only signal an in-flight job ever gets.
    setTimeout(() => process.exit(0), 3_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await loop.start();
}

main().catch((error) => {
  console.error({ component: "security-worker", event: "fatal_error", message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
