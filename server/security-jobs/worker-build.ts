/**
 * Which commit the worker bundle was built from, observable from the outside. The worker is a separate deployable (Railway) from the
 * Next.js app (Vercel): merging to main deploys Vercel but NOT the worker, so without this nobody can tell which generator/finalizer
 * the worker is running. The bundler (scripts/bundle-security-worker.mjs) injects the commit; it is "unknown" in any other context.
 */
declare const __WORKER_BUILD_COMMIT__: string | undefined;

export const WORKER_BUILD_COMMIT: string =
  typeof __WORKER_BUILD_COMMIT__ === "string" && __WORKER_BUILD_COMMIT__ ? __WORKER_BUILD_COMMIT__ : "unknown";

/**
 * Worker process id, recorded in security_jobs.claimed_by for every job it claims: with the build commit in it, the version that ran any
 * job is readable from the database (`worker-<commit7>-<pid>-<start>`).
 */
export function workerIdFor(input: { explicit?: string | null; commit: string; pid: number; startedAtMs: number }): string {
  const explicit = input.explicit?.trim();
  if (explicit) return explicit;
  const short = input.commit && input.commit !== "unknown" ? input.commit.slice(0, 7) : "nocommit";
  return `worker-${short}-${input.pid}-${input.startedAtMs}`;
}
