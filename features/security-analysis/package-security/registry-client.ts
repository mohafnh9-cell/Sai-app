import type { SbomEcosystem } from "../sbom/types";
import { REGISTRY_LOOKUP_CONCURRENCY, REGISTRY_TIMEOUT_MS } from "./constants";
import type { RegistryLookupResult } from "./types";
import { coalesceRegistryLookup, withRegistryProcessSlot } from "../shared/dependency-process-cache";

/** Same identifier GitHubRepositoryService uses for GitHub's API (lib/github/repository-service.ts). */
const REGISTRY_CLIENT_USER_AGENT = "SequrAI-Scanner/1.0";

export type RegistryClientOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cache?: Map<string, RegistryLookupResult>;
  /**
   * Phase 16: override for REGISTRY_LOOKUP_CONCURRENCY, additive and
   * default-preserving -- omitted, production behavior is unchanged. Exists
   * so the Phase 16B benchmark can exercise the real chunking/retry/cache
   * logic below at multiple concurrency levels without reimplementing it.
   */
  concurrency?: number;
  /**
   * Phase 22 -- optional timing instrumentation. Fires once per real
   * network attempt sequence (never per cache hit, never per coalesced
   * caller -- see onCoalesced below). Carries only ecosystem, status/
   * reason category, and durations -- no package name, no URL, no response
   * body, nothing sensitive. Purely observational: never affects scanning
   * behavior, security classification, or retry/timeout logic.
   */
  onLookupTiming?: (event: RegistryLookupTimingEvent) => void;
  /** Phase 22 -- fires when a caller reuses another caller's in-flight request (Phase 18 coalescing) instead of triggering a new one. */
  onCoalesced?: () => void;
};

export type RegistryLookupTimingEvent = {
  ecosystem: SbomEcosystem;
  status: RegistryLookupResult["status"];
  reason?: string;
  /** Total time spent waiting for a process-level semaphore slot, summed across attempts. */
  semaphoreWaitMs: number;
  /** Total time spent in the actual network fetch(es), summed across attempts. */
  networkMs: number;
  /** Full wall-clock time this lookup took, from first attempt to final result (semaphore wait + network + retry, if any). */
  totalMs: number;
  retried: boolean;
};

function cacheKey(ecosystem: SbomEcosystem, name: string): string {
  return `${ecosystem}:${name.toLowerCase()}`;
}

function encodeNpmPackage(name: string): string {
  return name.startsWith("@") ? name.replace("/", "%2F") : name;
}

function registryUrl(ecosystem: SbomEcosystem, name: string): string {
  switch (ecosystem) {
    case "npm":
      return `https://registry.npmjs.org/${encodeNpmPackage(name)}`;
    case "pypi":
      return `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
    case "crates":
      return `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;
    case "rubygems":
      return `https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`;
    case "go":
      return `https://proxy.golang.org/${encodeURIComponent(name)}/@v/list`;
    default:
      return "";
  }
}

/**
 * Phase 17 -- per-ecosystem lookup strategy. The question being asked is
 * only "does this dependency exist", never anything from the response
 * body's actual field values (verified per-ecosystem in Phase 17A: no
 * caller reads body.name/body.versions/etc., only "is this valid,
 * non-empty JSON"). Where a HEAD request gives an equivalent status-code
 * signal to GET, it avoids downloading/parsing megabytes of package
 * metadata for nothing (measured: react's real npm GET body is ~6.9MB;
 * HEAD returns the same 200 with zero body).
 *
 * NOT a blanket "HEAD everywhere" -- verified live against each real
 * registry before inclusion here:
 *   npm, pypi, rubygems -- HEAD returns the same status (200/404) as GET
 *     for both existing and nonexistent packages, no redirects observed,
 *     no auth required. Safe.
 *   crates.io -- HEAD returns 403 even for packages that DO exist (verified
 *     live against a real, published crate). A 403 must never be read as
 *     "does not exist" (Phase 17C), so HEAD is unusable here regardless of
 *     retry/caching logic -- GET required.
 *   go -- proxy.golang.org's existence signal for some responses depends on
 *     actual body content (an edge case beyond plain 404s -- see
 *     lookupSingle), not status alone. Not exhaustively verified safe for
 *     HEAD -- GET required, unchanged from before this phase.
 */
const HEAD_SAFE_ECOSYSTEMS = new Set<SbomEcosystem>(["npm", "pypi", "rubygems"]);

function lookupMethodFor(ecosystem: SbomEcosystem): "HEAD" | "GET" {
  return HEAD_SAFE_ECOSYSTEMS.has(ecosystem) ? "HEAD" : "GET";
}

async function fetchWithTimeout(
  url: string,
  method: "HEAD" | "GET",
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method,
      // Phase 18A: crates.io's real API rejects/blocks requests without a
      // descriptive User-Agent identifying the client (their published
      // crawler policy requires this of automated clients; verified live --
      // requests without one were returning 403 even for existing crates,
      // including on HEAD). Sent on every ecosystem, not just crates.io --
      // this is a safe, standard courtesy to any registry, and matches the
      // identifier GitHubRepositoryService already uses for GitHub's API.
      headers: { Accept: "application/json", "User-Agent": REGISTRY_CLIENT_USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupSingle(
  ecosystem: SbomEcosystem,
  name: string,
  options: RegistryClientOptions
): Promise<RegistryLookupResult> {
  const url = registryUrl(ecosystem, name);
  if (!url) {
    return { status: "skipped", reason: "unsupported_ecosystem" };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REGISTRY_TIMEOUT_MS;
  const method = lookupMethodFor(ecosystem);

  // Phase 22 instrumentation state -- purely additive, read only by the
  // single onLookupTiming emission below. Never influences the security
  // decision (status/reason) computed by the loop.
  const lookupStart = performance.now();
  let semaphoreWaitMs = 0;
  let networkMs = 0;
  let retried = false;

  function emit(result: RegistryLookupResult): RegistryLookupResult {
    // Instrumentation is observational only -- a bug in a caller-supplied
    // callback must never be able to break scanning (Phase 22's explicit
    // "instrumentation cannot alter scanner behavior" requirement).
    try {
      options.onLookupTiming?.({
        ecosystem,
        status: result.status,
        reason: result.reason,
        semaphoreWaitMs,
        networkMs,
        totalMs: performance.now() - lookupStart,
        retried,
      });
    } catch {
      // best-effort only
    }
    return result;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) retried = true;
    try {
      // Phase 21: caps the TOTAL number of real registry HTTP requests in
      // flight across this whole process at once, regardless of how many
      // scans are concurrently running -- see withRegistryProcessSlot's
      // docs for the measured fleet-pressure risk this closes. Per-scan
      // concurrency (runBoundedQueue below) and this process-wide cap are
      // independent, composable bounds.
      const attemptStart = performance.now();
      let thisAttemptWaitMs = 0;
      const response = await withRegistryProcessSlot(
        () => fetchWithTimeout(url, method, fetchImpl, timeoutMs),
        (waitMs) => {
          thisAttemptWaitMs = waitMs;
        }
      );
      semaphoreWaitMs += thisAttemptWaitMs;
      // The measured span covers semaphore wait + the actual fetch; subtract
      // the wait portion so networkMs reflects only real request time.
      networkMs += Math.max(0, performance.now() - attemptStart - thisAttemptWaitMs);
      if (response.status === 404) {
        return emit({ status: "not_found", registryUrl: url });
      }
      // 401/403/429/5xx all fail the !response.ok check below and become
      // "unavailable", identically for HEAD and GET -- never reinterpreted
      // as "does not exist". This is the exact protection crates.io's real
      // HEAD-returns-403-for-existing-packages behavior requires (Phase 17A);
      // crates.io stays on GET so it never reaches this branch via HEAD,
      // but the guard applies uniformly regardless.
      if (!response.ok) {
        return emit({ status: "unavailable", reason: `registry_status_${response.status}`, registryUrl: url });
      }

      if (method === "HEAD") {
        // No body was requested or transferred -- status alone (200, having
        // already passed the 404/!ok checks above) is the complete,
        // equivalent existence signal for HEAD_SAFE_ECOSYSTEMS.
        return emit({ status: "exists", registryUrl: url });
      }

      if (ecosystem === "go") {
        const text = await response.text();
        if (!text.trim()) {
          return emit({ status: "not_found", registryUrl: url });
        }
        return emit({ status: "exists", registryUrl: url });
      }

      const body = await response.json().catch(() => null);
      if (!body || typeof body !== "object") {
        return emit({ status: "unavailable", reason: "malformed_response", registryUrl: url });
      }
      return emit({ status: "exists", registryUrl: url });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
      if (attempt === 0 && reason === "timeout") {
        continue;
      }
      return emit({ status: "unavailable", reason, registryUrl: url });
    }
  }

  return emit({ status: "unavailable", reason: "timeout", registryUrl: url });
}

export async function lookupPackages(
  packages: Array<{ ecosystem: SbomEcosystem; name: string }>,
  options: RegistryClientOptions = {}
): Promise<Map<string, RegistryLookupResult>> {
  const cache = options.cache ?? new Map<string, RegistryLookupResult>();
  const results = new Map<string, RegistryLookupResult>();
  const unique = new Map<string, { ecosystem: SbomEcosystem; name: string }>();

  for (const pkg of packages) {
    unique.set(cacheKey(pkg.ecosystem, pkg.name), pkg);
  }

  const uncached: Array<{ key: string; pkg: { ecosystem: SbomEcosystem; name: string } }> = [];
  for (const [key, pkg] of unique) {
    const cached = cache.get(key);
    if (cached) {
      results.set(key, cached);
      continue;
    }
    uncached.push({ key, pkg });
  }

  const concurrency = options.concurrency ?? REGISTRY_LOOKUP_CONCURRENCY;
  await runBoundedQueue(uncached, concurrency, async ({ key, pkg }) => {
    // Phase 18 (Option F): if another concurrent scan on this process is
    // already fetching this exact key, share its in-flight promise instead
    // of firing a duplicate real request -- see coalesceRegistryLookup's
    // docs for why this differs from (and complements) the Phase 15
    // completed-result cache above. Unaffected by the scheduling model
    // below -- coalescing happens per-item regardless of how items are
    // scheduled.
    const result = await coalesceRegistryLookup(
      key,
      () => lookupSingle(pkg.ecosystem, pkg.name, options),
      options.onCoalesced
    );
    cache.set(key, result);
    results.set(key, result);
  });

  return results;
}

/**
 * Phase 19F/G -- bounded worker pool, replacing the previous chunk-barrier
 * model (wait for all N in a chunk before starting the next N). Proven via
 * a dedicated benchmark (features/security-analysis/__tests__/
 * phase19-scheduling-benchmark.test.ts) before this change was made: for
 * any realistic latency distribution with variance (which real registry
 * responses have -- Phase 18 measured p50=64ms but max=656ms for real npm
 * requests), the chunk-barrier model wastes time whenever one request in a
 * chunk is slow -- the other `concurrency - 1` workers sit idle instead of
 * picking up the next item, even though slots are free. A worker here
 * immediately pulls the next queued item the instant it finishes, so idle
 * time only occurs when the queue itself is empty. Peak concurrency is
 * identical to the old model (still exactly `concurrency` in flight at
 * once, never more) -- this changes *scheduling*, not *how many* requests
 * are ever concurrently in flight, so it does not increase external-service
 * pressure. In-process only: no real threads, no distributed queue.
 */
async function runBoundedQueue<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;

  async function runOneWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runOneWorker()));
}

export function createRegistryCache(): Map<string, RegistryLookupResult> {
  return new Map();
}

export { cacheKey as registryCacheKey };
