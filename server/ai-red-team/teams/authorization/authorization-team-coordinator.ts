import { randomUUID } from "node:crypto";
import { createRedTeamLogger } from "../../logging/red-team-logger";
import type { AuthorizationTeamInput, AuthorizationTeamResult } from "./authorization-team.types";
import { DEFAULT_AUTHZ_EVAL_BUDGET } from "./authorization-team.config";
import { detectAuthorizationSignals } from "./discovery/authz-discovery";
import { buildRoleGraph } from "./model/role-graph";
import { buildResourceGraph } from "./model/resource-graph";
import { buildAuthorizationMatrix, matrixSize } from "./model/authorization-matrix";
import type { AuthorizationSpecialistRegistry } from "./registry/authorization-specialist-registry";
import { createMockSafeAuthzRuntime, defaultSyntheticIdentities } from "./runtime/safe-authz-runtime";
import {
  confirmReplayFindings,
  dedupeAuthzFindings,
  validateAuthzFinding,
} from "./findings/authorization-finding-validator";
import type { AuthzFindingRecord } from "./findings/authorization-finding";
import { buildAuthzReplayPlans } from "./replay/authorization-replay-plan";
import { buildAuthzSafeFixCandidates } from "./safe-fix/authorization-safe-fix-bridge";

export type AuthorizationTeamCoordinatorDeps = {
  registry: AuthorizationSpecialistRegistry;
  logger?: ReturnType<typeof createRedTeamLogger>;
};

export class AuthorizationTeamCoordinator {
  constructor(private readonly deps: AuthorizationTeamCoordinatorDeps) {}

  async run(input: AuthorizationTeamInput): Promise<AuthorizationTeamResult> {
    const logger = this.deps.logger ?? createRedTeamLogger();
    const authorizationTeamRunId = randomUUID();
    const startedAt = Date.now();

    const policies = detectAuthorizationSignals(input.discoveryReport);
    const roleGraph = buildRoleGraph({ includeSuperAdmin: policies.hasAdminRoutes });
    const resourceGraph = buildResourceGraph(input.discoveryReport);
    const matrix = buildAuthorizationMatrix(roleGraph, resourceGraph);
    const identities = defaultSyntheticIdentities();

    const context = {
      authorizationTeamRunId,
      redTeamRunId: input.runId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      commitSha: null,
      discovery: input.discoveryReport,
      plan: input.plan,
      policies,
      roleGraph,
      resourceGraph,
      matrix,
      identities,
    };

    const runtime = createMockSafeAuthzRuntime({
      policies: {
        hasRls: policies.hasRls,
        hasAdminRoutes: policies.hasAdminRoutes,
      },
      profile:
        policies.hasRls &&
        policies.hasCustomRbac &&
        policies.engines.includes("supabase_rls")
          ? "secure"
          : "default",
    });

    const allFindings: AuthzFindingRecord[] = [];
    let evaluations = 0;

    try {
      for (const specialist of this.deps.registry.listAll()) {
        if (input.signal?.aborted || evaluations >= DEFAULT_AUTHZ_EVAL_BUDGET) break;
        if (!(await specialist.canRun(context))) continue;
        const scenarios = await specialist.plan(context);
        for (const scenario of scenarios) {
          if (input.signal?.aborted || evaluations >= DEFAULT_AUTHZ_EVAL_BUDGET) break;
          const result = await specialist.execute(runtime, scenario, context);
          evaluations += result.evaluations;
          allFindings.push(...result.findings);
        }
      }

      const deduped = dedupeAuthzFindings(allFindings.map(validateAuthzFinding));
      const findings = confirmReplayFindings(deduped);
      const replayPlans = buildAuthzReplayPlans(findings);
      const safeFixCandidates = buildAuthzSafeFixCandidates(findings);

      logger.log({
        event: "authorization_team_completed",
        requestId: input.requestId,
        metadata: {
          authorizationRunId: authorizationTeamRunId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          rolesDetected: roleGraph.nodes.length,
          resourcesDetected: resourceGraph.nodes.length,
          permissionsDetected: roleGraph.nodes.reduce((n, r) => n + r.permissions.length, 0),
          matrixSize: matrixSize(matrix),
          findings: findings.filter((f) => f.status !== "duplicate").length,
          replays: replayPlans.length,
          durationMs: Date.now() - startedAt,
        },
      });

      return {
        authorizationTeamRunId,
        status: evaluations >= DEFAULT_AUTHZ_EVAL_BUDGET ? "partially_completed" : "completed",
        rolesDetected: roleGraph.nodes.length,
        resourcesDetected: resourceGraph.nodes.length,
        matrixSize: matrixSize(matrix),
        findings,
        replayPlans,
        safeFixCandidateCount: safeFixCandidates.length,
        roleGraph,
        resourceGraph,
        matrix,
        partialReason: evaluations >= DEFAULT_AUTHZ_EVAL_BUDGET ? "eval_budget_exhausted" : null,
      };
    } finally {
      await runtime.close();
    }
  }
}

export function createAuthorizationTeamCoordinator(
  deps: AuthorizationTeamCoordinatorDeps
): AuthorizationTeamCoordinator {
  return new AuthorizationTeamCoordinator(deps);
}
