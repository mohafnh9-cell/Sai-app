import type { DiscoveryReport } from "../../../discovery/types";

export type AuthzPolicySignals = {
  engines: string[];
  hasRls: boolean;
  hasCustomRbac: boolean;
  hasTenantMiddleware: boolean;
  hasAdminRoutes: boolean;
  sources: string[];
};

export function detectAuthorizationSignals(discovery: DiscoveryReport): AuthzPolicySignals {
  const engines: string[] = [];
  const sources: string[] = [];
  const filesHint = discovery.projectSummary.toLowerCase();

  for (const tech of discovery.detectedTechnologies) {
    const name = tech.name.toLowerCase();
    if (name.includes("supabase")) {
      engines.push("supabase_rls");
      sources.push("technology:supabase");
    }
    if (name.includes("postgres") || name.includes("prisma")) {
      engines.push("postgres_rls");
      sources.push(`technology:${tech.name}`);
    }
    if (name.includes("firebase")) engines.push("firebase_rules");
    if (name.includes("clerk")) engines.push("clerk_organizations");
  }

  for (const tech of discovery.authenticationProviders) {
    if (/auth\.js|next-auth|clerk|supabase/i.test(tech.name)) {
      engines.push("jwt_roles");
      sources.push(`auth_provider:${tech.name}`);
    }
  }

  const hasAdminRoutes = discovery.potentialAttackSurface.some((s) => s.area === "admin_area");
  const hasRls = engines.some((e) => e.includes("rls"));
  const hasCustomRbac = discovery.potentialAttackSurface.some((s) => s.area === "authorization");
  const hasTenantMiddleware =
    hasCustomRbac || engines.includes("clerk_organizations") || filesHint.includes("tenant");

  return {
    engines: [...new Set(engines)],
    hasRls,
    hasCustomRbac,
    hasTenantMiddleware,
    hasAdminRoutes,
    sources,
  };
}
