import type { BusinessLogicRunStore, PersistBusinessLogicRunInput, PersistBusinessLogicRunOutcome } from "./store.types";
import {
  buildRunHeaderFromResult,
  serializeBusinessLogicArtifacts,
} from "./serialize-run-artifacts";

export type PersistBusinessLogicRunDeps = {
  store: BusinessLogicRunStore;
  performanceMs?: number;
};

/**
 * Idempotent persistence: same run id + idempotency key overwrites artifact rows for that run.
 * Safe to retry after partial failure.
 */
export async function persistBusinessLogicRun(
  input: PersistBusinessLogicRunInput,
  deps: PersistBusinessLogicRunDeps
): Promise<PersistBusinessLogicRunOutcome | null> {
  if (input.result.status === "skipped" && !input.partial) {
    return null;
  }

  if (input.idempotencyKey) {
    const existing = await deps.store.findByIdempotency(input.projectId, input.idempotencyKey);
    if (existing && existing.id !== input.result.businessLogicTeamRunId) {
      return {
        runId: existing.id,
        revision: 0,
        persisted: false,
        partialPersistence: false,
        counts: {
          workflows: 0,
          fsms: 0,
          invariants: 0,
          abuseCases: 0,
          specialists: 0,
          runtimeResults: 0,
          findings: 0,
          replayPlans: 0,
        },
      };
    }
  }

  const artifacts = serializeBusinessLogicArtifacts(input.result);
  const header = buildRunHeaderFromResult({
    result: input.result,
    organizationId: input.organizationId,
    projectId: input.projectId,
    redTeamRunId: input.redTeamRunId,
    scanJobId: input.scanJobId,
    idempotencyKey: input.idempotencyKey,
    startedAtIso: input.startedAtIso,
    completedAtIso: input.completedAtIso,
    partial: input.partial,
    observabilityExtra: deps.performanceMs != null ? { persistenceMs: deps.performanceMs } : undefined,
  });

  return deps.store.persistRun({
    header,
    artifacts,
    revisionReason: input.revisionReason ?? (input.partial ? "partial_recovery" : "run_complete"),
  });
}

export async function recoverPartialBusinessLogicRun(
  input: PersistBusinessLogicRunInput,
  deps: PersistBusinessLogicRunDeps
): Promise<PersistBusinessLogicRunOutcome | null> {
  return persistBusinessLogicRun({ ...input, partial: true }, deps);
}
