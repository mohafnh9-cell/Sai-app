import type { DiscoveryReport } from "../../discovery/types";

export type AuthorizationResourceNode = {
  id: string;
  label: string;
  kind: string;
  tenantScoped: boolean;
  ownerScoped: boolean;
};

export type AuthorizationResourceGraph = {
  nodes: AuthorizationResourceNode[];
};

export function buildResourceGraph(discovery: DiscoveryReport): AuthorizationResourceGraph {
  const nodes: AuthorizationResourceNode[] = [
    resource("users", "Users", "identity", true, true),
    resource("organizations", "Organizations", "tenant", true, false),
    resource("projects", "Projects", "workspace", true, true),
    resource("invoices", "Invoices", "billing", true, true),
    resource("subscriptions", "Subscriptions", "billing", true, true),
    resource("files", "Files", "storage", true, true),
    resource("api_keys", "API Keys", "secret", true, true),
    resource("webhooks", "Webhooks", "integration", true, false),
    resource("repositories", "Repositories", "code", true, true),
  ];

  if (discovery.payments.length > 0) {
    nodes.push(resource("payments", "Payments", "billing", true, true));
  }
  if (discovery.potentialAttackSurface.some((s) => s.area === "admin_area")) {
    nodes.push(resource("admin_panel", "Admin Dashboard", "admin", false, false));
  }

  return { nodes };
}

function resource(
  id: string,
  label: string,
  kind: string,
  tenantScoped: boolean,
  ownerScoped: boolean
): AuthorizationResourceNode {
  return { id, label, kind, tenantScoped, ownerScoped };
}
