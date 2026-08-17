import type { SbomEcosystem } from "../sbom/types";
import { REGISTRY_LOOKUP_CONCURRENCY, REGISTRY_TIMEOUT_MS } from "./constants";
import type { RegistryLookupResult } from "./types";

export type RegistryClientOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cache?: Map<string, RegistryLookupResult>;
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

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
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

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchWithTimeout(url, fetchImpl, timeoutMs);
      if (response.status === 404) {
        return { status: "not_found", registryUrl: url };
      }
      if (!response.ok) {
        return { status: "unavailable", reason: `registry_status_${response.status}`, registryUrl: url };
      }

      if (ecosystem === "go") {
        const text = await response.text();
        if (!text.trim()) {
          return { status: "not_found", registryUrl: url };
        }
        return { status: "exists", registryUrl: url };
      }

      const body = await response.json().catch(() => null);
      if (!body || typeof body !== "object") {
        return { status: "unavailable", reason: "malformed_response", registryUrl: url };
      }
      return { status: "exists", registryUrl: url };
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
      if (attempt === 0 && reason === "timeout") {
        continue;
      }
      return { status: "unavailable", reason, registryUrl: url };
    }
  }

  return { status: "unavailable", reason: "timeout", registryUrl: url };
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

  for (let index = 0; index < uncached.length; index += REGISTRY_LOOKUP_CONCURRENCY) {
    const chunk = uncached.slice(index, index + REGISTRY_LOOKUP_CONCURRENCY);
    await Promise.all(
      chunk.map(async ({ key, pkg }) => {
        const result = await lookupSingle(pkg.ecosystem, pkg.name, options);
        cache.set(key, result);
        results.set(key, result);
      })
    );
  }

  return results;
}

export function createRegistryCache(): Map<string, RegistryLookupResult> {
  return new Map();
}

export { cacheKey as registryCacheKey };
