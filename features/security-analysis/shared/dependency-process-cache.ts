import "server-only";
import type { RegistryLookupResult } from "../package-security/types";
import type { OsvApiVulnerability } from "../osv/types";

/**
 * Phase 15 -- cross-scan dependency-intelligence cache.
 *
 * Root cause (measured in Phase 14.1): package-security.scan-packages and
 * dependencies.osv-sbom dominate scan latency (63-82% of total scan time on
 * real repos) because every scan re-verifies every declared dependency
 * against registry.npmjs.org/pypi.org/etc. and api.osv.dev from scratch --
 * even though real-world repos share enormous overlap in popular packages
 * (react, lodash, express...), and a single org rescanning the same repo
 * repeatedly re-checks an unchanged dependency tree every time.
 *
 * This is a per-process, in-memory, TTL-bounded cache -- explicitly NOT
 * Redis or any shared/distributed store, because nothing measured this
 * phase demonstrates a need to share it across serverless instances; a
 * warm Vercel instance already serves many scans over its lifetime, and
 * that's the benefit this captures. If measurement later shows most scans
 * land on cold/distinct instances, a shared store becomes worth revisiting
 * -- not before.
 *
 * SECURITY: only POSITIVE, well-formed intelligence is ever promoted here.
 * A failed/unavailable/timed-out lookup is NEVER cached cross-scan -- doing
 * so would let a transient registry outage silently make later scans treat
 * an unverifiable dependency as if it had been checked. See
 * isPromotableRegistryStatus below and the promote* call sites in
 * analyze.ts and enrich-sbom.ts for the enforcement point.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);
function isExplicitlyTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized != null && TRUTHY.has(normalized);
}

/** Kill switch: falls back to the pre-Phase-15 per-scan-only behavior instantly, no redeploy. */
export function isDependencyProcessCacheDisabled(): boolean {
  return isExplicitlyTruthy(process.env.SEQURAI_DEP_CACHE_DISABLED);
}

function envMs(name: string, fallbackMs: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

/**
 * Package *existence* (registry lookup) is a stable fact -- a published
 * package essentially never becomes unpublished-then-renamed within an
 * hour, so a longer TTL is safe and maximizes hit rate for the dominant
 * cost. Vulnerability data (OSV) is the opposite: a brand-new CVE can be
 * disclosed for an already-published version at any moment, so its TTL is
 * intentionally much shorter -- correctness over hit rate, per the Phase
 * 15 security requirement.
 */
const REGISTRY_CACHE_TTL_MS = envMs("SEQURAI_DEP_CACHE_TTL_REGISTRY_MS", 60 * 60_000);
const OSV_CACHE_TTL_MS = envMs("SEQURAI_DEP_CACHE_TTL_OSV_MS", 15 * 60_000);

/** Bounds memory in a long-lived instance; oldest entries evicted first (Map preserves insertion order). */
const MAX_ENTRIES_PER_CACHE = 5_000;

class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= MAX_ENTRIES_PER_CACHE && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

const registryProcessCache = new TtlCache<RegistryLookupResult>(REGISTRY_CACHE_TTL_MS);
const osvProcessCache = new TtlCache<OsvApiVulnerability[]>(OSV_CACHE_TTL_MS);

/** Only "exists" and "not_found" are stable, safe-to-reuse facts. "unavailable"/"skipped" must never persist cross-scan. */
function isPromotableRegistryStatus(status: RegistryLookupResult["status"]): boolean {
  return status === "exists" || status === "not_found";
}

/**
 * Seeds a fresh per-scan Map with cross-scan hits for the given keys, then
 * returns it for use as lookupPackages'/queryOsvBatch's own per-scan cache
 * -- their existing dedup/fetch/retry logic is untouched. After the scan,
 * call the matching promote* function to feed fresh results back.
 */
export function seedRegistryScanCache(keys: string[]): Map<string, RegistryLookupResult> {
  const scanCache = new Map<string, RegistryLookupResult>();
  if (isDependencyProcessCacheDisabled()) return scanCache;
  for (const key of keys) {
    const cached = registryProcessCache.get(key);
    if (cached) scanCache.set(key, cached);
  }
  return scanCache;
}

export function promoteRegistryResults(results: Map<string, RegistryLookupResult>): void {
  if (isDependencyProcessCacheDisabled()) return;
  for (const [key, result] of results) {
    if (isPromotableRegistryStatus(result.status)) {
      registryProcessCache.set(key, result);
    }
  }
}

/**
 * OSV's own queryOsvBatch already only writes to its cache param on a
 * successful, parsed response (never on a thrown/failed batch) -- so every
 * entry present in a post-call scan cache is genuine, successfully-fetched
 * intelligence (including a real empty array = "checked, currently clean").
 * Safe to promote all of it as-is.
 */
export function promoteOsvResults(scanCache: Map<string, OsvApiVulnerability[]>): void {
  if (isDependencyProcessCacheDisabled()) return;
  for (const [key, vulns] of scanCache) {
    osvProcessCache.set(key, vulns);
  }
}

export function seedOsvScanCacheFromProcess(keys: string[]): Map<string, OsvApiVulnerability[]> {
  const scanCache = new Map<string, OsvApiVulnerability[]>();
  if (isDependencyProcessCacheDisabled()) return scanCache;
  for (const key of keys) {
    const cached = osvProcessCache.get(key);
    if (cached) scanCache.set(key, cached);
  }
  return scanCache;
}

/** Test-only: clears both process caches so tests don't leak state across runs. */
export function resetDependencyProcessCachesForTests(): void {
  registryProcessCache.clear();
  osvProcessCache.clear();
  inFlightRegistryLookups.clear();
}

export function dependencyProcessCacheSizesForTests(): { registry: number; osv: number; inFlight: number } {
  return { registry: registryProcessCache.size, osv: osvProcessCache.size, inFlight: inFlightRegistryLookups.size };
}

/**
 * Phase 18 (Option F) -- in-flight request coalescing for registry lookups.
 *
 * The Phase 15 cache only helps once a lookup has *completed*. During a
 * burst of concurrent scans (multiple orgs' scans landing on the same warm
 * instance at once -- the realistic 1,000-queued-scans scenario), two scans
 * can both start a real network request for the same dependency (e.g.
 * "lodash") within the same few milliseconds, before either's request has
 * resolved -- the completed-result cache can't help there, since neither
 * result exists yet. This map lets a second (or third, or Nth) concurrent
 * request for the same key simply await the first one's in-flight promise
 * instead of firing a duplicate real HTTP request.
 *
 * lookupSingle's contract never rejects (every failure mode -- timeout,
 * network error, 4xx/5xx -- resolves to a RegistryLookupResult with
 * status "unavailable", never a thrown error), which simplifies this: there
 * is no rejection path to guard against duplicating work on failure. The
 * `finally` cleanup still matters, for two reasons: (1) unbounded growth
 * would leak memory in a long-lived instance, and (2) once a request
 * settles it must leave this map immediately so a *later* scan (outside the
 * coalescing window) goes through the normal TTL cache/fresh-fetch path in
 * registry-client.ts, rather than incorrectly treating a long-since-resolved
 * promise as "still in flight" forever.
 */
const inFlightRegistryLookups = new Map<string, Promise<RegistryLookupResult>>();

export function coalesceRegistryLookup(
  key: string,
  fetchFn: () => Promise<RegistryLookupResult>,
  /** Phase 22 instrumentation only -- fires when a caller reuses another caller's in-flight request instead of triggering a new one. Never affects behavior. */
  onCoalesced?: () => void
): Promise<RegistryLookupResult> {
  if (isDependencyProcessCacheDisabled()) return fetchFn();

  const existing = inFlightRegistryLookups.get(key);
  if (existing) {
    // Same "instrumentation cannot alter scanner behavior" guarantee as
    // registry-client.ts's emit() -- never let a caller's callback bug
    // break coalescing.
    try {
      onCoalesced?.();
    } catch {
      // best-effort only
    }
    return existing;
  }

  const pending = fetchFn().finally(() => {
    inFlightRegistryLookups.delete(key);
  });
  inFlightRegistryLookups.set(key, pending);
  return pending;
}

/**
 * Phase 21 -- process-level aggregate registry-request concurrency cap.
 *
 * Root problem (measured directly this phase, not assumed): per-scan
 * concurrency (registry-client.ts's runBoundedQueue) only bounds ONE scan's
 * own requests. It does not coordinate across concurrent scans on the same
 * process. A benchmark run this phase proved the real risk: at per-scan
 * concurrency 16 with zero process-level cap, 10 concurrent scans produced
 * a measured peak of 160 simultaneous real registry connections; 100
 * concurrent scans produced 1,600 -- unbounded, linear in scan count. This
 * is exactly the "8 requests x many concurrent scans" fleet-pressure risk
 * flagged since Phase 16.
 *
 * This semaphore fixes that: every real registry HTTP attempt (see
 * lookupSingle's use of acquireRegistryProcessSlot in registry-client.ts)
 * must acquire a slot here first, regardless of which scan or ecosystem it
 * belongs to. The same benchmark, rerun with this cap at 32, held peak
 * process-wide concurrency at exactly 32 across 10/25/50/100 simulated
 * concurrent scans -- proven, not assumed.
 *
 * This is a PER-PROCESS limiter only -- it cannot and does not coordinate
 * across separate Vercel/Inngest serverless instances (no shared state
 * exists between them without a distributed store, deliberately not
 * introduced here; see the Phase 21 report's "Global / Process Limiting"
 * section for the explicit per-scan/per-process/per-instance/fleet
 * distinction). It bounds THIS instance's own external-connection pressure,
 * which is still a real, direct improvement over no bound at all.
 */
const REGISTRY_PROCESS_CONCURRENCY = (() => {
  const raw = process.env.SEQURAI_REGISTRY_PROCESS_CONCURRENCY?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 32;
})();

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  get activeCount(): number {
    return this.active;
  }
}

const registryProcessSemaphore = new Semaphore(REGISTRY_PROCESS_CONCURRENCY);

/**
 * Acquires one process-wide registry-request slot, runs `fn`, releases the
 * slot afterward regardless of success/failure. Disabled by the same kill
 * switch as the rest of this module (SEQURAI_DEP_CACHE_DISABLED) -- falls
 * back to running `fn` immediately, unbounded, matching pre-Phase-21
 * behavior exactly.
 */
export async function withRegistryProcessSlot<T>(
  fn: () => Promise<T>,
  /** Phase 22 instrumentation only -- reports time spent waiting for a slot. Never affects behavior. */
  onWait?: (waitMs: number) => void
): Promise<T> {
  if (isDependencyProcessCacheDisabled()) return fn();
  const waitStart = performance.now();
  const release = await registryProcessSemaphore.acquire();
  onWait?.(performance.now() - waitStart);
  try {
    return await fn();
  } finally {
    release();
  }
}

export function registryProcessConcurrencyForTests(): { max: number; active: number } {
  return { max: REGISTRY_PROCESS_CONCURRENCY, active: registryProcessSemaphore.activeCount };
}
