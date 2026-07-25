import "server-only";

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export type WorkflowLogContext = {
  requestId: string;
  organizationId?: string | null;
  projectId?: string | null;
  reviewId?: string | null;
  safeFixId?: string | null;
};

const storage = new AsyncLocalStorage<WorkflowLogContext>();

export function runWithRequestContext<T>(ctx: Partial<WorkflowLogContext>, fn: () => T): T {
  const base: WorkflowLogContext = {
    requestId: ctx.requestId ?? randomUUID(),
    organizationId: ctx.organizationId ?? null,
    projectId: ctx.projectId ?? null,
    reviewId: ctx.reviewId ?? null,
    safeFixId: ctx.safeFixId ?? null,
  };
  return storage.run(base, fn);
}

export function getWorkflowLogContext(): WorkflowLogContext {
  return (
    storage.getStore() ?? {
      requestId: "no-request",
      organizationId: null,
      projectId: null,
      reviewId: null,
      safeFixId: null,
    }
  );
}

export function logWorkflowEvent(input: {
  component: string;
  event: string;
  status: "ok" | "error" | "retry" | "skipped";
  durationMs?: number;
  fields?: Record<string, unknown>;
}): void {
  const ctx = getWorkflowLogContext();
  console.info({
    component: input.component,
    event: input.event,
    status: input.status,
    durationMs: input.durationMs ?? null,
    requestId: ctx.requestId,
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    reviewId: ctx.reviewId,
    safeFixId: ctx.safeFixId,
    ...input.fields,
  });
}
