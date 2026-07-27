import { randomUUID } from "node:crypto";
import type {
  AuthorizationSpecialist,
  AuthorizationTeamContext,
  AuthzScenario,
  AuthzSpecialistResult,
} from "../authorization-team.types";
import type { SafeAuthzRuntime } from "../runtime/safe-authz-runtime";
import { defaultSyntheticIdentities, scenarioFromKind } from "../runtime/safe-authz-runtime";
import { newAuthzFinding } from "../findings/authorization-finding";

abstract class BaseAuthzSpecialist implements AuthorizationSpecialist {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly priority: number;

  canRun(): boolean {
    return true;
  }

  abstract plan(context: AuthorizationTeamContext): Promise<AuthzScenario[]>;
  abstract execute(
    runtime: SafeAuthzRuntime,
    scenario: AuthzScenario,
    context: AuthorizationTeamContext
  ): Promise<AuthzSpecialistResult>;
}

function findingFromViolation(
  specialist: string,
  category: string,
  title: string,
  scenario: AuthzScenario,
  severity: "critical" | "high" | "medium"
): ReturnType<typeof newAuthzFinding> {
  return newAuthzFinding({
    specialist,
    category,
    title,
    founderSummary: title,
    technicalExplanation: `${scenario.role} performed ${scenario.action} on ${scenario.resource}`,
    role: scenario.role,
    resource: scenario.resource,
    action: scenario.action,
    severity,
    confidence: 0.9,
    status: "candidate",
    correlationKeys: [`authz:${category}`, `resource:${scenario.resource}`],
    safeFixEligible: true,
    remediationDirection: "Enforce authorization at the resource boundary.",
    replayEligible: true,
    provenance: ["safe_authz_runtime", "synthetic_identity"],
  });
}

async function runScenario(
  runtime: SafeAuthzRuntime,
  scenario: AuthzScenario,
  context: AuthorizationTeamContext,
  specialistId: string,
  category: string,
  title: string,
  severity: "critical" | "high" | "medium",
  evalInput: Parameters<SafeAuthzRuntime["evaluate"]>[0]
): Promise<AuthzSpecialistResult> {
  const result = await runtime.evaluate(evalInput);
  const findings = [];
  if (result.allowed && result.observedStatus !== result.expectedStatus) {
    findings.push(findingFromViolation(specialistId, category, title, scenario, severity));
  }
  return {
    specialistId,
    scenariosExecuted: 1,
    findings,
    evaluations: 1,
    logs: [`${scenario.kind} expected=${result.expectedStatus} observed=${result.observedStatus}`],
  };
}

export class RoleModelSpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.role_model";
  readonly name = "Role Model Specialist";
  readonly priority = 10;

  async plan(context: AuthorizationTeamContext) {
    return [
      scenarioFromKind(this.id, "role_graph", {
        id: randomUUID(),
        title: "Validate role hierarchy coverage",
        role: "user",
        resource: "projects",
        action: "read",
      }),
    ];
  }

  async execute(_runtime: SafeAuthzRuntime, _scenario: AuthzScenario, context: AuthorizationTeamContext) {
    return {
      specialistId: this.id,
      scenariosExecuted: 1,
      findings: [],
      evaluations: context.roleGraph.nodes.length,
      logs: [`roles=${context.roleGraph.nodes.length}`],
    };
  }
}

export class TenantIsolationSpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.tenant";
  readonly name = "Tenant Isolation Specialist";
  readonly priority = 20;

  canRun(context: AuthorizationTeamContext) {
    return context.policies.hasTenantMiddleware || context.resourceGraph.nodes.some((n) => n.tenantScoped);
  }

  async plan() {
    return [
      scenarioFromKind(this.id, "tenant_isolation", {
        id: randomUUID(),
        title: "Tenant A reads Tenant B resource",
        role: "user",
        resource: "organizations",
        action: "read",
      }),
    ];
  }

  async execute(runtime: SafeAuthzRuntime, scenario: AuthzScenario, context: AuthorizationTeamContext) {
    const identity = defaultSyntheticIdentities().find((i) => i.tenantId === "tenant-a")!;
    return runScenario(runtime, scenario, context, this.id, "tenant_isolation_failure", "Tenant isolation failure", "critical", {
      identity,
      resourceId: scenario.resource,
      action: scenario.action,
      targetTenantId: "tenant-b",
      scenarioKind: "tenant_isolation",
    });
  }
}

export class ObjectAuthorizationSpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.object";
  readonly name = "Object Authorization Specialist";
  readonly priority = 30;

  async plan() {
    return [
      scenarioFromKind(this.id, "object_ownership", {
        id: randomUUID(),
        title: "User updates another user profile",
        role: "user",
        resource: "users",
        action: "update",
      }),
    ];
  }

  async execute(runtime: SafeAuthzRuntime, scenario: AuthzScenario, context: AuthorizationTeamContext) {
    const identity = defaultSyntheticIdentities()[0];
    return runScenario(runtime, scenario, context, this.id, "broken_object_authorization", "Broken Object Level Authorization", "high", {
      identity,
      resourceId: scenario.resource,
      action: scenario.action,
      targetOwnerId: "other-user",
      scenarioKind: "object_ownership",
    });
  }
}

export class FunctionAuthorizationSpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.function";
  readonly name = "Function Authorization Specialist";
  readonly priority = 40;

  canRun(context: AuthorizationTeamContext) {
    return context.policies.hasAdminRoutes;
  }

  async plan() {
    return [
      scenarioFromKind(this.id, "admin_function", {
        id: randomUUID(),
        title: "User accesses admin endpoint",
        role: "user",
        resource: "admin_panel",
        action: "manage",
      }),
    ];
  }

  async execute(runtime: SafeAuthzRuntime, scenario: AuthzScenario, context: AuthorizationTeamContext) {
    const identity = defaultSyntheticIdentities()[0];
    return runScenario(runtime, scenario, context, this.id, "broken_function_authorization", "Admin route accessible", "critical", {
      identity,
      resourceId: scenario.resource,
      action: scenario.action,
      scenarioKind: "admin_function",
    });
  }
}

export class RlsSpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.rls";
  readonly name = "RLS Specialist";
  readonly priority = 50;

  async plan(context: AuthorizationTeamContext) {
    return [
      scenarioFromKind(this.id, "rls_check", {
        id: randomUUID(),
        title: context.policies.hasRls ? "Verify row-level security" : "Row-level security missing",
        role: "user",
        resource: "projects",
        action: "read",
      }),
    ];
  }

  async execute(runtime: SafeAuthzRuntime, scenario: AuthzScenario, context: AuthorizationTeamContext) {
    if (!context.policies.hasRls) {
      return {
        specialistId: this.id,
        scenariosExecuted: 1,
        findings: [
          findingFromViolation(this.id, "broken_rls", "Row-level security disabled or missing", scenario, "critical"),
        ],
        evaluations: 1,
        logs: ["rls=disabled"],
      };
    }
    const identity = defaultSyntheticIdentities()[0];
    const result = await runScenario(runtime, scenario, context, this.id, "broken_rls", "Broken RLS", "critical", {
      identity,
      resourceId: scenario.resource,
      action: scenario.action,
      scenarioKind: "rls_check",
    });
    return result;
  }
}

export class PrivilegeEscalationSpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.privilege";
  readonly name = "Privilege Escalation Specialist";
  readonly priority = 60;

  async plan() {
    return [
      scenarioFromKind(this.id, "privilege_escalation", {
        id: randomUUID(),
        title: "User manages organization",
        role: "user",
        resource: "organizations",
        action: "manage",
      }),
    ];
  }

  async execute(runtime: SafeAuthzRuntime, scenario: AuthzScenario, context: AuthorizationTeamContext) {
    const identity = defaultSyntheticIdentities()[0];
    return runScenario(runtime, scenario, context, this.id, "privilege_escalation", "Privilege escalation", "critical", {
      identity,
      resourceId: scenario.resource,
      action: scenario.action,
      scenarioKind: "privilege_escalation",
    });
  }
}

export class RbacSpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.rbac";
  readonly name = "RBAC Specialist";
  readonly priority = 70;

  canRun(context: AuthorizationTeamContext) {
    return context.policies.hasCustomRbac || context.roleGraph.nodes.length > 0;
  }

  async plan(context: AuthorizationTeamContext) {
    return context.matrix.cells
      .filter((c) => c.roleId === "admin" && c.state === "allowed")
      .slice(0, 1)
      .map((c) =>
        scenarioFromKind(this.id, "rbac_matrix", {
          id: randomUUID(),
          title: `RBAC ${c.roleId} ${c.action} ${c.resourceId}`,
          role: c.roleId,
          resource: c.resourceId,
          action: c.action,
        })
      );
  }

  async execute(_runtime: SafeAuthzRuntime, scenario: AuthzScenario, context: AuthorizationTeamContext) {
    return {
      specialistId: this.id,
      scenariosExecuted: 1,
      findings: [],
      evaluations: context.matrix.cells.length,
      logs: [`matrix=${context.matrix.cells.length}`, scenario.title],
    };
  }
}

export class PermissionSpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.permission";
  readonly name = "Permission Specialist";
  readonly priority = 15;

  async plan(context: AuthorizationTeamContext) {
    return context.roleGraph.nodes.slice(0, 2).map((node) =>
      scenarioFromKind(this.id, "permission_extract", {
        id: randomUUID(),
        title: `Permissions for ${node.label}`,
        role: node.id,
        resource: "projects",
        action: "read",
      })
    );
  }

  async execute(_runtime: SafeAuthzRuntime, scenario: AuthzScenario, context: AuthorizationTeamContext) {
    const node = context.roleGraph.nodes.find((n) => n.id === scenario.role);
    return {
      specialistId: this.id,
      scenariosExecuted: 1,
      findings: [],
      evaluations: node?.permissions.length ?? 0,
      logs: [`permissions=${node?.permissions.length ?? 0}`],
    };
  }
}

export class OwnershipSpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.ownership";
  readonly name = "Ownership Specialist";
  readonly priority = 35;

  async plan(context: AuthorizationTeamContext) {
    return context.resourceGraph.nodes
      .filter((n) => n.ownerScoped)
      .slice(0, 2)
      .map((n) =>
        scenarioFromKind(this.id, "ownership", {
          id: randomUUID(),
          title: `Owner-only ${n.label}`,
          role: "user",
          resource: n.id,
          action: "delete",
        })
      );
  }

  async execute(runtime: SafeAuthzRuntime, scenario: AuthzScenario, context: AuthorizationTeamContext) {
    const identity = defaultSyntheticIdentities()[0];
    return runScenario(runtime, scenario, context, this.id, "missing_ownership_validation", "Missing ownership validation", "high", {
      identity,
      resourceId: scenario.resource,
      action: scenario.action,
      targetOwnerId: "other-user",
      scenarioKind: "object_ownership",
    });
  }
}

export class AbacSpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.abac";
  readonly name = "ABAC Specialist";
  readonly priority = 75;

  async plan() {
    return [
      scenarioFromKind(this.id, "abac", {
        id: randomUUID(),
        title: "Attribute policy check",
        role: "moderator",
        resource: "files",
        action: "export",
      }),
    ];
  }

  async execute(_runtime: SafeAuthzRuntime, _scenario: AuthzScenario, context: AuthorizationTeamContext) {
    return {
      specialistId: this.id,
      scenariosExecuted: 1,
      findings: [],
      evaluations: 1,
      logs: [`engines=${context.policies.engines.join(",")}`],
    };
  }
}

export class PolicyConsistencySpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.policy_consistency";
  readonly name = "Policy Consistency Specialist";
  readonly priority = 80;

  async plan(context: AuthorizationTeamContext) {
    if (context.policies.engines.length < 2) return [];
    return [
      scenarioFromKind(this.id, "policy_conflict", {
        id: randomUUID(),
        title: "Cross-engine policy consistency",
        role: "admin",
        resource: "projects",
        action: "manage",
      }),
    ];
  }

  async execute(_runtime: SafeAuthzRuntime, _scenario: AuthzScenario, context: AuthorizationTeamContext) {
    const conflict = context.policies.hasRls && context.policies.hasCustomRbac;
    const findings = conflict
      ? [
          newAuthzFinding({
            specialist: this.id,
            category: "policy_conflict",
            title: "Conflicting authorization rules",
            founderSummary: "Middleware RBAC and database RLS may disagree on access.",
            technicalExplanation: `Engines: ${context.policies.engines.join(", ")}`,
            role: "admin",
            resource: "projects",
            action: "manage",
            severity: "medium",
            confidence: 0.6,
            status: "candidate",
            correlationKeys: ["authz:policy_conflict"],
            safeFixEligible: true,
            remediationDirection: "Centralize authorization policy source of truth.",
            replayEligible: false,
            provenance: ["discovery"],
          }),
        ]
      : [];
    return {
      specialistId: this.id,
      scenariosExecuted: 1,
      findings,
      evaluations: 1,
      logs: [`conflict=${conflict}`],
    };
  }
}

export class AdminBoundarySpecialist extends BaseAuthzSpecialist {
  readonly id = "authz.admin_boundary";
  readonly name = "Admin Boundary Specialist";
  readonly priority = 45;

  canRun(context: AuthorizationTeamContext) {
    return context.policies.hasAdminRoutes;
  }

  async plan() {
    return [
      scenarioFromKind(this.id, "admin_function", {
        id: randomUUID(),
        title: "Admin boundary probe",
        role: "moderator",
        resource: "admin_panel",
        action: "configure",
      }),
    ];
  }

  async execute(runtime: SafeAuthzRuntime, scenario: AuthzScenario, context: AuthorizationTeamContext) {
    const identity = { ...defaultSyntheticIdentities()[0], role: "moderator" };
    return runScenario(runtime, scenario, context, this.id, "broken_function_authorization", "Admin boundary violation", "high", {
      identity,
      resourceId: scenario.resource,
      action: scenario.action,
      scenarioKind: "admin_function",
    });
  }
}

export function createDefaultAuthorizationSpecialists(): AuthorizationSpecialist[] {
  return [
    new RoleModelSpecialist(),
    new PermissionSpecialist(),
    new TenantIsolationSpecialist(),
    new OwnershipSpecialist(),
    new RbacSpecialist(),
    new AbacSpecialist(),
    new RlsSpecialist(),
    new PrivilegeEscalationSpecialist(),
    new FunctionAuthorizationSpecialist(),
    new AdminBoundarySpecialist(),
    new ObjectAuthorizationSpecialist(),
    new PolicyConsistencySpecialist(),
  ];
}
