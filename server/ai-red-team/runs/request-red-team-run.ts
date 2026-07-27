import { randomUUID } from "node:crypto";
import type { AttackRequest, RedTeamReport } from "../types";
import type { AttackAuthorizationRecord } from "../authorization";
import { validateAttackAuthorization } from "../authorization";
import type { RedTeamRunStore } from "./red-team-run-store";
import type { SecurityDirector } from "../director/security-director";

export type RequestRedTeamRunInput = {
  request: AttackRequest;
  targetUrl: string;
  authorization: AttackAuthorizationRecord;
  idempotencyKey?: string;
  asyncMode?: boolean;
};

export type RequestRedTeamRunResult =
  | { mode: "async"; runId: string; status: "queued" }
  | { mode: "sync"; report: RedTeamReport };

export async function requestRedTeamBrowserRun(
  director: SecurityDirector,
  store: RedTeamRunStore,
  input: RequestRedTeamRunInput
): Promise<RequestRedTeamRunResult> {
  const validation = validateAttackAuthorization(input.authorization, { targetUrl: input.targetUrl });
  if (!validation.ok) {
    throw new Error(`${validation.code}: ${validation.message}`);
  }

  if (input.idempotencyKey) {
    const existing = await store.findActiveByIdempotency(
      input.request.context.projectId,
      input.idempotencyKey
    );
    if (existing) {
      return { mode: "async", runId: existing.id, status: "queued" };
    }
  }

  const runId = randomUUID();
  await store.create({
    id: runId,
    organizationId: input.request.context.organizationId,
    projectId: input.request.context.projectId,
    authorizationId: input.authorization.id,
    idempotencyKey: input.idempotencyKey ?? null,
    status: input.asyncMode === false ? "testing" : "queued",
    commitSha: input.authorization.commitSha,
    targetOrigin: input.authorization.targetOrigin,
    environmentType: input.authorization.environmentType,
    discoveryReportId: null,
    executionLeaseToken: randomUUID(),
    metadata: { targetUrl: input.targetUrl },
  });

  if (input.asyncMode !== false) {
    return { mode: "async", runId, status: "queued" };
  }

  const report = await director.run({
    ...input.request,
    requestId: runId,
    context: {
      ...input.request.context,
      metadata: {
        ...(input.request.context.metadata ?? {}),
        browserAttack: {
          targetUrl: input.targetUrl,
          authorization: input.authorization,
          redTeamRunId: runId,
        },
      },
    },
  });

  await store.updateStatus(runId, report.summary.failed > 0 ? "failed" : "completed", {
    discoveryReportId: report.discovery.reportId,
  });

  return { mode: "sync", report };
}

export async function executeQueuedRedTeamRun(
  director: SecurityDirector,
  store: RedTeamRunStore,
  runId: string,
  input: {
    request: AttackRequest;
    targetUrl: string;
    authorization: AttackAuthorizationRecord;
  }
): Promise<RedTeamReport> {
  const run = await store.getById(runId);
  if (!run) throw new Error(`Red team run not found: ${runId}`);
  if (run.executionLeaseToken && run.metadata.leaseConsumed) {
    throw new Error("Stale worker rejected: lease already consumed");
  }

  await store.updateStatus(runId, "exploring");
  const report = await director.run({
    ...input.request,
    requestId: runId,
    context: {
      ...input.request.context,
      metadata: {
        ...(input.request.context.metadata ?? {}),
        browserAttack: {
          targetUrl: input.targetUrl,
          authorization: input.authorization,
          redTeamRunId: runId,
          browserTeamRunId: randomUUID(),
        },
      },
    },
  });

  const terminal =
    report.results.some((r) => r.metadata?.partialReason) ||
    report.results.some((r) => r.agentId === "surface.browser" && r.metadata?.partialReason)
      ? "partially_completed"
      : report.summary.failed > 0
        ? "failed"
        : "completed";

  await store.updateStatus(runId, terminal, {
    discoveryReportId: report.discovery.reportId,
    metadata: { ...run.metadata, leaseConsumed: true },
  });

  return report;
}
