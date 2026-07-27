import type { DiscoveryReport } from "../types";

type CacheEntry = {
  report: DiscoveryReport;
  storedAt: number;
};

const store = new Map<string, CacheEntry>();

/** Default TTL — invalidation is primarily commit-scoped via cache key. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(projectId: string, commitSha: string): string {
  return `${projectId}:${commitSha}`;
}

export function getCachedDiscoveryReport(
  projectId: string,
  commitSha: string
): DiscoveryReport | null {
  const hit = store.get(cacheKey(projectId, commitSha));
  if (!hit) return null;
  if (Date.now() - hit.storedAt > DEFAULT_TTL_MS) {
    store.delete(cacheKey(projectId, commitSha));
    return null;
  }
  return hit.report;
}

export function setCachedDiscoveryReport(
  projectId: string,
  commitSha: string,
  report: DiscoveryReport
): void {
  store.set(cacheKey(projectId, commitSha), { report, storedAt: Date.now() });
}

export function invalidateDiscoveryCache(projectId: string, commitSha?: string): void {
  if (commitSha) {
    store.delete(cacheKey(projectId, commitSha));
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(`${projectId}:`)) store.delete(key);
  }
}

export function resetDiscoveryCacheForTests(): void {
  store.clear();
}
