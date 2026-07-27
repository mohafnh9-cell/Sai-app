import type { AttackRequest } from "../types";
import type { DecisionContext } from "./decision-context";
import { DEFAULT_MIN_COVERAGE_SCORE } from "./decision-context";

export function buildDecisionContextFromRequest(
  request: AttackRequest,
  discoveryCommitSha: string
): DecisionContext {
  const dc = request.decisionContext;
  return {
    projectId: request.context.projectId,
    organizationId: request.context.organizationId,
    commitSha: dc?.commitSha ?? discoveryCommitSha,
    deploymentEnvironment: dc?.deploymentEnvironment ?? "preview",
    memory: dc?.memory ?? request.intelligenceContext?.memory ?? null,
    acceptedRisks: dc?.acceptedRisks ?? [],
    safeFixStatus: dc?.safeFixStatus ?? "none",
    replayStatus: dc?.replayStatus ?? "not_run",
    redTeamRunStatus:
      dc?.redTeamRunStatus ??
      (request.attackSimulation
        ? request.attackSimulation.async !== false
          ? "queued"
          : "completed"
        : "none"),
    evidenceCommitSha: dc?.evidenceCommitSha ?? discoveryCommitSha,
    previousDecision: dc?.previousDecision ?? null,
    minCoverageScore: dc?.minCoverageScore ?? DEFAULT_MIN_COVERAGE_SCORE,
  };
}
