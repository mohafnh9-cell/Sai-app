import { packageIdentity } from "../sbom/purl";
import type { SbomComponent } from "../sbom/types";
import {
  cacheKeyForPackage,
  mapOsvVulnerability,
  osvEcosystemForQuery,
  osvPackageNameForQuery,
  toOsvQueryPackage,
} from "./map-vulnerability";
import {
  OSV_BATCH_SIZE,
  OSV_BATCH_URL,
  OSV_FETCH_TIMEOUT_MS,
  OsvQueryError,
  type OsvApiVulnerability,
  type OsvBatchResult,
  type OsvQueryPackage,
} from "./types";

export type OsvClientOptions = {
  fetchImpl?: typeof fetch;
  cache?: Map<string, OsvApiVulnerability[]>;
  timeoutMs?: number;
};

function isQueryPackage(value: OsvQueryPackage | null): value is OsvQueryPackage {
  return value != null;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  retries = 1
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    if (response.status === 429 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return fetchWithRetry(url, init, fetchImpl, timeoutMs, retries - 1);
    }
    return response;
  } catch (error) {
    clearTimeout(timeout);
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return fetchWithRetry(url, init, fetchImpl, timeoutMs, retries - 1);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new OsvQueryError("OSV request timed out", "timeout");
    }
    throw new OsvQueryError(
      error instanceof Error ? error.message : "OSV network request failed",
      "network_error"
    );
  }
}

function parseBatchResponse(body: unknown): OsvApiVulnerability[][] {
  if (!body || typeof body !== "object" || !("results" in body)) {
    throw new OsvQueryError("Malformed OSV batch response", "malformed_response");
  }
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    throw new OsvQueryError("Malformed OSV batch response", "malformed_response");
  }
  return results.map((entry) => {
    if (!entry || typeof entry !== "object" || !("vulns" in entry)) return [];
    const vulns = (entry as { vulns?: unknown }).vulns;
    return Array.isArray(vulns) ? (vulns as OsvApiVulnerability[]) : [];
  });
}

/**
 * Query OSV.dev with only package name, version, and ecosystem — no source code.
 */
export async function queryOsvBatch(
  packages: OsvQueryPackage[],
  options: OsvClientOptions = {}
): Promise<OsvBatchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? OSV_FETCH_TIMEOUT_MS;
  const results: OsvBatchResult = new Map();
  const memoryCache = options.cache;
  const uncached: OsvQueryPackage[] = [];

  for (const pkg of packages) {
    const key = cacheKeyForPackage(pkg);
    const cached = memoryCache?.get(key);
    if (cached) {
      const mapped = cached
        .map((entry) => mapOsvVulnerability(entry, pkg))
        .filter((entry): entry is NonNullable<typeof entry> => entry != null);
      if (mapped.length > 0) results.set(key, mapped);
      continue;
    }
    uncached.push(pkg);
  }

  for (let index = 0; index < uncached.length; index += OSV_BATCH_SIZE) {
    const chunk = uncached.slice(index, index + OSV_BATCH_SIZE);
    const queries = chunk.map((pkg) => ({
      package: {
        name: osvPackageNameForQuery(pkg),
        ecosystem: osvEcosystemForQuery(pkg.ecosystem),
      },
      version: pkg.version,
    }));

    try {
      const response = await fetchWithRetry(
        OSV_BATCH_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries }),
        },
        fetchImpl,
        timeoutMs
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new OsvQueryError("OSV rate limited", "rate_limited");
        }
        throw new OsvQueryError(`OSV unavailable (${response.status})`, "unavailable");
      }

      const body = await response.json();
      const batchResults = parseBatchResponse(body);

      for (let i = 0; i < chunk.length; i += 1) {
        const pkg = chunk[i];
        const key = cacheKeyForPackage(pkg);
        const rawVulns = batchResults[i] ?? [];
        memoryCache?.set(key, rawVulns);
        const mapped = rawVulns
          .map((entry) => mapOsvVulnerability(entry, pkg))
          .filter((entry): entry is NonNullable<typeof entry> => entry != null);
        if (mapped.length > 0) results.set(key, mapped);
      }
    } catch (error) {
      if (error instanceof OsvQueryError) {
        throw error;
      }
      throw new OsvQueryError(
        error instanceof Error ? error.message : "OSV query failed",
        "network_error"
      );
    }
  }

  return results;
}

export function componentsToOsvPackages(components: SbomComponent[]): OsvQueryPackage[] {
  return components.map(toOsvQueryPackage).filter(isQueryPackage);
}

export function packageIdentityKey(component: SbomComponent): string {
  return packageIdentity(component);
}

export function createOsvMemoryCache(): Map<string, OsvApiVulnerability[]> {
  return new Map();
}
