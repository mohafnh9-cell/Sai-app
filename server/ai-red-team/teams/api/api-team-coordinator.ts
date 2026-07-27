import { randomUUID } from "node:crypto";
import { validateAttackAuthorization } from "../../authorization";
import { createRedTeamLogger } from "../../logging/red-team-logger";
import type { ApiTeamInput, ApiTeamResult } from "./api-team.types";
import { DEFAULT_API_TEAM_BUDGET } from "./api-team.config";
import { buildApiSurfaceFromDiscovery } from "./discovery/api-surface-builder";
import type { ApiSpecialistRegistry } from "./registry/api-specialist-registry";
import { mockSafeApiRuntimeFactory } from "./runtime/mock-api-runtime";
import type { SafeApiRuntimeFactory } from "./runtime/safe-api-runtime";
import { ApiRequestBudget } from "./runtime/request-budget";
import { dedupeApiFindings, validateApiFinding } from "./findings/api-finding-validator";
import type { ApiFindingRecord } from "./findings/api-finding";
import { buildApiReplayPlans } from "./replay/api-replay-plan";
import { buildApiSafeFixCandidates } from "./safe-fix/api-safe-fix-bridge";

export type ApiTeamCoordinatorDeps = {
  registry: ApiSpecialistRegistry;
  runtimeFactory?: SafeApiRuntimeFactory;
  logger?: ReturnType<typeof createRedTeamLogger>;
};

export class ApiTeamCoordinator {
  constructor(private readonly deps: ApiTeamCoordinatorDeps) {}

  async run(input: ApiTeamInput): Promise<ApiTeamResult> {
    const logger = this.deps.logger ?? createRedTeamLogger();
    const apiTeamRunId = randomUUID();
    const startedAt = Date.now();
    const targetUrl = `${input.targetOrigin.replace(/\/$/, "")}/`;

    const authCheck = validateAttackAuthorization(input.authorization, { targetUrl });
    if (!authCheck.ok) {
      throw new Error(`${authCheck.code}: ${authCheck.message}`);
    }

    const budget = new ApiRequestBudget(
      DEFAULT_API_TEAM_BUDGET,
      input.authorization.maxRequestBudget
    );
    const surface = buildApiSurfaceFromDiscovery(input.discoveryReport);
    const context = {
      apiTeamRunId,
      redTeamRunId: input.runId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      commitSha: input.commitSha ?? null,
      targetOrigin: input.targetOrigin,
      environmentType: input.environment,
      authorization: input.authorization,
      discovery: input.discoveryReport,
      plan: input.plan,
      surface,
    };

    const runtime = await (this.deps.runtimeFactory ?? mockSafeApiRuntimeFactory).create({
      targetOrigin: input.targetOrigin,
      authorization: input.authorization,
      budget,
      signal: input.signal,
    });

    const allFindings: ApiFindingRecord[] = [];
    let scenariosExecuted = 0;

    try {
      for (const specialist of this.deps.registry.listAll()) {
        if (input.signal?.aborted || budget.exhausted) break;
        if (!(await specialist.canRun(context))) continue;
        const scenarios = await specialist.plan(context);
        for (const scenario of scenarios) {
          if (input.signal?.aborted || budget.exhausted) break;
          const result = await specialist.execute(runtime, scenario, context);
          scenariosExecuted += result.scenariosExecuted;
          allFindings.push(...result.findings);
        }
      }

      const findings = dedupeApiFindings(allFindings.map(validateApiFinding));
      const replayPlans = buildApiReplayPlans(findings);
      const safeFixCandidates = buildApiSafeFixCandidates(findings, {
        projectId: input.projectId,
        organizationId: input.organizationId,
      });

      logger.log({
        event: "api_team_completed",
        requestId: input.requestId,
        metadata: {
          apiTeamRunId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          environment: input.environment,
          commitSha: input.commitSha ?? null,
          endpointsDiscovered: surface.endpoints.length,
          specialistsExecuted: this.deps.registry.listAll().length,
          findingsGenerated: findings.filter((f) => f.status !== "duplicate").length,
          replayPlansGenerated: replayPlans.length,
          replayEligibleFindings: findings.filter((f) => f.replayEligible).length,
          safeFixCandidates: safeFixCandidates.length,
          durationMs: Date.now() - startedAt,
          status: budget.exhausted ? "partially_completed" : "completed",
          authorizationId: input.authorization.id,
        },
      });

      return {
        apiTeamRunId,
        status: budget.exhausted ? "partially_completed" : "completed",
        endpointsDiscovered: surface.endpoints.length,
        scenariosExecuted,
        findings,
        replayPlans,
        safeFixCandidateCount: safeFixCandidates.length,
        surface,
        partialReason: budget.exhausted ? "request_budget_exhausted" : null,
      };
    } finally {
      await runtime.close();
    }
  }
}

export function createApiTeamCoordinator(deps: ApiTeamCoordinatorDeps): ApiTeamCoordinator {
  return new ApiTeamCoordinator(deps);
}
