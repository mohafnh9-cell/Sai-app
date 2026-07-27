import type { DiscoveryReport } from "../../discovery/types";
import type { DiscoverySignals } from "../aso.types";

export function analyzeDiscoverySignals(discovery: DiscoveryReport): DiscoverySignals {
  const summary = discovery.projectSummary.toLowerCase();
  const techNames = discovery.detectedTechnologies.map((t) => t.name.toLowerCase()).join(" ");
  const surfaces = discovery.potentialAttackSurface.map((s) => s.area);

  const hasAuthentication =
    discovery.authenticationProviders.length > 0 ||
    surfaces.includes("authentication") ||
    /auth|clerk|supabase|next-auth/i.test(techNames);

  const hasApiSurface =
    surfaces.includes("rest_api") ||
    surfaces.includes("graphql") ||
    /next\.js|express|fastify|trpc/i.test(techNames);

  const hasAuthorizationModel =
    surfaces.includes("authorization") ||
    surfaces.includes("admin_area") ||
    discovery.authenticationProviders.length > 0;

  const hasPayments = discovery.payments.length > 0 || surfaces.includes("payments");
  const hasLlm =
    discovery.aiProviders.length > 0 ||
    surfaces.includes("llm") ||
    /openai|anthropic|langchain|vercel.*ai/i.test(techNames);

  const hasMcp = /mcp|model context protocol/i.test(summary + techNames);
  const hasBusinessWorkflows = hasPayments || surfaces.includes("admin_area") || hasAuthorizationModel;

  const isStaticSite =
    !hasAuthentication &&
    !hasApiSurface &&
    !hasPayments &&
    !hasLlm &&
    (surfaces.length === 0 ||
      (surfaces.length === 1 && (surfaces[0] === "browser" || surfaces[0] === "third_party_services")));

  const hasBrowserSurface = !isStaticSite || surfaces.includes("browser") || true;

  return {
    hasBrowserSurface,
    hasAuthentication,
    hasApiSurface,
    hasAuthorizationModel,
    hasPayments,
    hasBusinessWorkflows,
    hasLlm,
    hasMcp,
    isStaticSite,
    frameworkHints: discovery.detectedTechnologies.map((t) => t.name),
  };
}
