import "server-only";

type CacheEntry<T> = { value: T; expiresAt: number; tag: string };

const store = new Map<string, CacheEntry<unknown>>();

export type CacheNamespace =
  | "production_memory_summary"
  | "protection_center_model"
  | "report_summary"
  | "mcp_context";

const DEFAULT_TTL_MS: Record<CacheNamespace, number> = {
  production_memory_summary: 60_000,
  protection_center_model: 45_000,
  report_summary: 120_000,
  mcp_context: 30_000,
};

function key(namespace: CacheNamespace, projectId: string, suffix = ""): string {
  return `${namespace}:${projectId}${suffix ? `:${suffix}` : ""}`;
}

export function invalidateProjectCache(projectId: string, namespace?: CacheNamespace): void {
  for (const k of store.keys()) {
    if (!k.includes(projectId)) continue;
    if (namespace && !k.startsWith(`${namespace}:`)) continue;
    store.delete(k);
  }
}

export async function cachedRead<T>(
  namespace: CacheNamespace,
  projectId: string,
  loader: () => Promise<T>,
  options?: { ttlMs?: number; suffix?: string; tag?: string }
): Promise<T> {
  const cacheKey = key(namespace, projectId, options?.suffix);
  const tag = options?.tag ?? "v1";
  const now = Date.now();
  const hit = store.get(cacheKey);
  if (hit && hit.expiresAt > now && hit.tag === tag) {
    return hit.value as T;
  }
  const value = await loader();
  store.set(cacheKey, {
    value,
    expiresAt: now + (options?.ttlMs ?? DEFAULT_TTL_MS[namespace]),
    tag,
  });
  return value;
}

export function resetReadCacheForTests(): void {
  store.clear();
}
