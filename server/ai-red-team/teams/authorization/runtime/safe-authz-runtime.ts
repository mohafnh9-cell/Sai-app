import type { AuthzAction, AuthzScenario, SyntheticIdentity } from "../authorization-team.types";

export type AuthzEvaluationResult = {
  expectedStatus: 403 | 200;
  observedStatus: number;
  allowed: boolean;
  replayConfirmed: boolean;
};

export type SafeAuthzRuntime = {
  evaluate(input: {
    identity: SyntheticIdentity;
    resourceId: string;
    action: AuthzAction;
    targetTenantId?: string;
    targetOwnerId?: string;
    scenarioKind: string;
  }): Promise<AuthzEvaluationResult>;
  close(): Promise<void>;
};

export function createMockSafeAuthzRuntime(input: {
  policies: { hasRls: boolean; hasAdminRoutes: boolean };
  profile?: "default" | "secure";
}): SafeAuthzRuntime {
  const profile = input.profile ?? "default";
  return {
    async evaluate(evalInput) {
      if (profile === "secure") {
        return { expectedStatus: 403, observedStatus: 403, allowed: false, replayConfirmed: true };
      }
      const { identity, resourceId, action, scenarioKind, targetTenantId } = evalInput;

      if (scenarioKind === "tenant_isolation") {
        const crossTenant = targetTenantId && targetTenantId !== identity.tenantId;
        if (crossTenant && action === "read") {
          return { expectedStatus: 403, observedStatus: 200, allowed: true, replayConfirmed: true };
        }
      }

      if (scenarioKind === "admin_function") {
        if (resourceId === "admin_panel" && identity.role !== "admin" && identity.role !== "owner") {
          return { expectedStatus: 403, observedStatus: 403, allowed: false, replayConfirmed: true };
        }
      }

      if (scenarioKind === "object_ownership") {
        const otherUser = evalInput.targetOwnerId && evalInput.targetOwnerId !== identity.id;
        if (otherUser && (action === "update" || action === "write")) {
          return { expectedStatus: 403, observedStatus: 200, allowed: true, replayConfirmed: true };
        }
      }

      if (scenarioKind === "rls_check" && !input.policies.hasRls) {
        return { expectedStatus: 403, observedStatus: 200, allowed: true, replayConfirmed: true };
      }

      if (scenarioKind === "privilege_escalation") {
        if (identity.role === "user" && action === "manage" && resourceId === "organizations") {
          return { expectedStatus: 403, observedStatus: 200, allowed: true, replayConfirmed: true };
        }
      }

      return { expectedStatus: 403, observedStatus: 403, allowed: false, replayConfirmed: true };
    },
    async close() {},
  };
}

export function defaultSyntheticIdentities(): SyntheticIdentity[] {
  return [
    { id: "syn-user-a", label: "Tenant A User", role: "user", tenantId: "tenant-a" },
    { id: "syn-user-b", label: "Tenant B User", role: "user", tenantId: "tenant-b" },
    { id: "syn-admin-a", label: "Tenant A Admin", role: "admin", tenantId: "tenant-a" },
  ];
}

export function scenarioFromKind(
  specialistId: string,
  kind: string,
  partial: Partial<AuthzScenario>
): AuthzScenario {
  return {
    id: partial.id ?? kind,
    specialistId,
    title: partial.title ?? kind,
    role: partial.role ?? "user",
    resource: partial.resource ?? "users",
    action: partial.action ?? "read",
    kind,
    ...partial,
  };
}
