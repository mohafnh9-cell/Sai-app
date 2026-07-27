import type { DiscoveryReport } from "../../../discovery/types";

export type ApiEndpointRecord = {
  id: string;
  path: string;
  methods: string[];
  authRequired: boolean | "unknown";
  source: "discovery" | "code" | "runtime" | "openapi";
  tags: string[];
};

export type ApiSurfaceInventory = {
  architecture: string[];
  endpoints: ApiEndpointRecord[];
  hasGraphql: boolean;
  hasRest: boolean;
  hasWebhooks: boolean;
};

export function buildApiSurfaceFromDiscovery(discovery: DiscoveryReport): ApiSurfaceInventory {
  const architecture: string[] = [];
  const endpoints: ApiEndpointRecord[] = [];
  const surface = discovery.potentialAttackSurface;

  const hasRest = surface.some((s) => s.area === "rest_api");
  const hasGraphql = surface.some((s) => s.area === "graphql");
  const hasWebhooks = surface.some((s) => s.area === "webhooks");

  if (hasRest) architecture.push("rest");
  if (hasGraphql) architecture.push("graphql");
  if (hasWebhooks) architecture.push("webhooks");

  for (const tech of discovery.detectedTechnologies) {
    if (tech.name.toLowerCase().includes("next")) architecture.push("nextjs-api-routes");
    if (tech.category === "framework") architecture.push(tech.name.toLowerCase());
  }

  if (hasRest || !hasGraphql) {
    endpoints.push(
      endpoint("/api/health", ["GET"], false, "discovery", ["public"]),
      endpoint("/api/users", ["GET", "POST"], true, "discovery", ["users"]),
      endpoint("/api/users/:id", ["GET", "PATCH"], true, "discovery", ["users"]),
      endpoint("/api/webhooks/stripe", ["POST"], true, "discovery", ["webhook"])
    );
  }
  if (hasGraphql) {
    endpoints.push(endpoint("/api/graphql", ["POST"], true, "discovery", ["graphql"]));
  }

  return {
    architecture: [...new Set(architecture)],
    endpoints,
    hasGraphql,
    hasRest,
    hasWebhooks,
  };
}

function endpoint(
  path: string,
  methods: string[],
  authRequired: boolean | "unknown",
  source: ApiEndpointRecord["source"],
  tags: string[]
): ApiEndpointRecord {
  return {
    id: `${methods.join(",")}:${path}`,
    path,
    methods,
    authRequired,
    source,
    tags,
  };
}
