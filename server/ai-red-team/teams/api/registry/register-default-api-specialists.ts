import { randomUUID } from "node:crypto";
import type { ApiScenario, ApiSpecialist, ApiSpecialistResult, ApiTeamContext } from "../api-team.types";
import type { SafeApiRuntime } from "../runtime/safe-api-runtime";
import { newApiFinding } from "../findings/api-finding";

abstract class BaseApiSpecialist implements ApiSpecialist {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly priority: number;
  abstract readonly capabilities: ApiSpecialist["capabilities"];

  canRun(): boolean {
    return true;
  }

  abstract plan(context: ApiTeamContext): Promise<ApiScenario[]>;
  abstract execute(
    runtime: SafeApiRuntime,
    scenario: ApiScenario,
    context: ApiTeamContext
  ): Promise<ApiSpecialistResult>;
}

export class EndpointInventorySpecialist extends BaseApiSpecialist {
  readonly id = "api.inventory";
  readonly name = "Endpoint Inventory";
  readonly priority = 10;
  readonly capabilities = ["inventory"] as const;

  async plan(context: ApiTeamContext) {
    return context.surface.endpoints.slice(0, 5).map((e) => ({
      id: randomUUID(),
      specialistId: this.id,
      title: `Inventory ${e.path}`,
      route: e.path,
      method: e.methods[0] ?? "GET",
      kind: "inventory",
    }));
  }

  async execute(_runtime: SafeApiRuntime, scenario: ApiScenario, context: ApiTeamContext) {
    return {
      specialistId: this.id,
      scenariosExecuted: 1,
      findings: [],
      logs: [`inventory ${context.surface.endpoints.length} endpoints`, scenario.route],
    };
  }
}

export class ErrorHandlingSpecialist extends BaseApiSpecialist {
  readonly id = "api.errors";
  readonly name = "Error Handling";
  readonly priority = 20;
  readonly capabilities = ["errors"] as const;

  async plan() {
    return [
      {
        id: randomUUID(),
        specialistId: this.id,
        title: "Probe validation error",
        route: "/api/users",
        method: "POST",
        kind: "error_probe",
      },
    ];
  }

  async execute(runtime: SafeApiRuntime, scenario: ApiScenario) {
    const res = await runtime.request({ method: scenario.method, path: scenario.route, json: { role: "admin" } });
    const findings = [];
    if (res.status >= 500) {
      findings.push(
        newApiFinding({
          specialist: this.id,
          category: "error_disclosure",
          title: "Verbose API error response",
          founderSummary: "The API returns detailed error information that may help attackers.",
          technicalExplanation: `Received HTTP ${res.status} with fingerprint ${res.bodyFingerprint}`,
          route: scenario.route,
          method: scenario.method,
          severity: "medium",
          confidence: 0.75,
          status: "candidate",
          correlationKeys: ["api-error-disclosure"],
          safeFixEligible: true,
          remediationDirection: "Return generic errors in production; log details server-side only.",
          replayEligible: true,
          provenance: ["runtime", "safe_api_runtime"],
        })
      );
    }
    return { specialistId: this.id, scenariosExecuted: 1, findings, logs: [`status ${res.status}`] };
  }
}

export class CorsSpecialist extends BaseApiSpecialist {
  readonly id = "api.cors";
  readonly name = "CORS Specialist";
  readonly priority = 30;
  readonly capabilities = ["cors"] as const;

  async plan() {
    return [
      {
        id: randomUUID(),
        specialistId: this.id,
        title: "CORS preflight",
        route: "/api/users",
        method: "OPTIONS",
        kind: "cors",
      },
    ];
  }

  async execute(runtime: SafeApiRuntime, scenario: ApiScenario) {
    const res = await runtime.request({ method: "OPTIONS", path: scenario.route });
    const findings = [];
    const acao = res.headers["access-control-allow-origin"];
    const acac = res.headers["access-control-allow-credentials"];
    if (acao === "*" && acac === "true") {
      findings.push(
        newApiFinding({
          specialist: this.id,
          category: "cors",
          title: "Unsafe CORS configuration",
          founderSummary: "CORS allows any origin with credentials — a risky combination.",
          technicalExplanation: "access-control-allow-origin: * with allow-credentials: true",
          route: scenario.route,
          method: "OPTIONS",
          severity: "high",
          confidence: 0.85,
          status: "candidate",
          correlationKeys: ["cors-wildcard-credentials"],
          safeFixEligible: true,
          remediationDirection: "Use explicit allowed origins; never combine * with credentials.",
          replayEligible: true,
          provenance: ["runtime", "headers"],
        })
      );
    }
    return { specialistId: this.id, scenariosExecuted: 1, findings, logs: ["cors checked"] };
  }
}

export class ObjectAccessSpecialist extends BaseApiSpecialist {
  readonly id = "api.object_access";
  readonly name = "Object Access";
  readonly priority = 40;
  readonly capabilities = ["access_control"] as const;

  async plan() {
    return [
      {
        id: randomUUID(),
        specialistId: this.id,
        title: "IDOR probe",
        route: "/api/users/999",
        method: "GET",
        kind: "object_access",
      },
    ];
  }

  async execute(runtime: SafeApiRuntime, scenario: ApiScenario) {
    const res = await runtime.request({ method: "GET", path: scenario.route });
    const findings = [];
    if (res.ok && res.bodyFingerprint) {
      findings.push(
        newApiFinding({
          specialist: this.id,
          category: "object_access",
          title: "Potential object access without cross-identity validation",
          founderSummary: "A predictable object identifier returned data — verify authorization checks.",
          technicalExplanation: "GET by identifier returned 200; cross-identity validation not demonstrated.",
          route: scenario.route,
          method: "GET",
          severity: "medium",
          confidence: 0.55,
          status: "candidate",
          correlationKeys: ["idor-candidate"],
          safeFixEligible: true,
          remediationDirection: "Enforce object-level authorization for every identifier.",
          replayEligible: true,
          provenance: ["runtime"],
        })
      );
    }
    return { specialistId: this.id, scenariosExecuted: 1, findings, logs: ["object access probe"] };
  }
}

export class InputValidationSpecialist extends BaseApiSpecialist {
  readonly id = "api.input_validation";
  readonly name = "Input Validation";
  readonly priority = 50;
  readonly capabilities = ["validation"] as const;

  async plan() {
    return [
      {
        id: randomUUID(),
        specialistId: this.id,
        title: "Malformed JSON probe",
        route: "/api/users",
        method: "POST",
        kind: "validation",
      },
    ];
  }

  async execute(runtime: SafeApiRuntime, scenario: ApiScenario) {
    await runtime.request({ method: "POST", path: scenario.route, json: {} });
    return { specialistId: this.id, scenariosExecuted: 1, findings: [], logs: ["validation probe"] };
  }
}

export class MassAssignmentSpecialist extends BaseApiSpecialist {
  readonly id = "api.mass_assignment";
  readonly name = "Mass Assignment";
  readonly priority = 60;
  readonly capabilities = ["validation"] as const;

  async plan() {
    return [
      {
        id: randomUUID(),
        specialistId: this.id,
        title: "Role field probe",
        route: "/api/users",
        method: "POST",
        kind: "mass_assignment",
      },
    ];
  }

  async execute(runtime: SafeApiRuntime, scenario: ApiScenario) {
    const res = await runtime.request({
      method: "POST",
      path: scenario.route,
      json: { email: "test@example.com", role: "admin" },
    });
    const findings = [];
    if (res.status >= 500) {
      findings.push(
        newApiFinding({
          specialist: this.id,
          category: "mass_assignment",
          title: "Privileged field accepted in request body",
          founderSummary: "The API may accept sensitive fields like role without strict allowlisting.",
          technicalExplanation: "Server responded with error/disclosure when role field was supplied.",
          route: scenario.route,
          method: "POST",
          severity: "medium",
          confidence: 0.6,
          status: "candidate",
          correlationKeys: ["mass-assignment"],
          safeFixEligible: true,
          remediationDirection: "Allowlist writable fields; reject unknown privileged attributes.",
          replayEligible: true,
          provenance: ["runtime", "request_body"],
        })
      );
    }
    return { specialistId: this.id, scenariosExecuted: 1, findings, logs: ["mass assignment probe"] };
  }
}

export class GraphqlSpecialist extends BaseApiSpecialist {
  readonly id = "api.graphql";
  readonly name = "GraphQL";
  readonly priority = 70;
  readonly capabilities = ["graphql"] as const;

  canRun(context: ApiTeamContext) {
    return context.surface.hasGraphql;
  }

  async plan(context: ApiTeamContext) {
    if (!context.surface.hasGraphql) return [];
    return [
      {
        id: randomUUID(),
        specialistId: this.id,
        title: "GraphQL introspection probe",
        route: "/api/graphql",
        method: "POST",
        kind: "graphql",
      },
    ];
  }

  async execute(runtime: SafeApiRuntime, scenario: ApiScenario) {
    await runtime.request({ method: "POST", path: scenario.route, json: { query: "{ __typename }" } });
    return { specialistId: this.id, scenariosExecuted: 1, findings: [], logs: ["graphql probe"] };
  }
}

export function createDefaultApiSpecialists(): ApiSpecialist[] {
  return [
    new EndpointInventorySpecialist(),
    new ErrorHandlingSpecialist(),
    new CorsSpecialist(),
    new ObjectAccessSpecialist(),
    new InputValidationSpecialist(),
    new MassAssignmentSpecialist(),
    new GraphqlSpecialist(),
  ];
}
