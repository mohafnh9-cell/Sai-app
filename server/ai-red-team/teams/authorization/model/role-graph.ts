export type AuthorizationRoleNode = {
  id: string;
  label: string;
  permissions: string[];
  parentRoleId: string | null;
};

export type AuthorizationRoleGraph = {
  nodes: AuthorizationRoleNode[];
};

const DEFAULT_ROLES = [
  { id: "anonymous", label: "Anonymous", permissions: ["read:public"], parent: null },
  { id: "user", label: "User", permissions: ["read:own", "write:own"], parent: "anonymous" },
  { id: "moderator", label: "Moderator", permissions: ["read:org", "manage:content"], parent: "user" },
  { id: "admin", label: "Admin", permissions: ["manage:org", "read:all"], parent: "moderator" },
  { id: "owner", label: "Owner", permissions: ["manage:billing", "delete:org"], parent: "admin" },
];

export function buildRoleGraph(input?: { includeSuperAdmin?: boolean }): AuthorizationRoleGraph {
  const nodes: AuthorizationRoleNode[] = DEFAULT_ROLES.map((r) => ({
    id: r.id,
    label: r.label,
    permissions: r.permissions,
    parentRoleId: r.parent,
  }));
  if (input?.includeSuperAdmin) {
    nodes.push({
      id: "super_admin",
      label: "Super Admin",
      permissions: ["impersonate", "manage:all"],
      parentRoleId: "owner",
    });
  }
  return { nodes };
}
