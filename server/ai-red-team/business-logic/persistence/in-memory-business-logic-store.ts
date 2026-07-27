import type {
  BusinessLogicPersistArtifacts,
  BusinessLogicRunRecord,
  BusinessLogicRunStore,
  PersistBusinessLogicRunOutcome,
} from "./store.types";

type RunBundle = {
  header: BusinessLogicRunRecord;
  artifacts: BusinessLogicPersistArtifacts;
  revision: number;
};

export class InMemoryBusinessLogicRunStore implements BusinessLogicRunStore {
  private runs = new Map<string, RunBundle>();
  private idempotency = new Map<string, string>();

  private idemKey(projectId: string, key: string): string {
    return `${projectId}:${key}`;
  }

  async findByIdempotency(
    projectId: string,
    idempotencyKey: string
  ): Promise<BusinessLogicRunRecord | null> {
    const runId = this.idempotency.get(this.idemKey(projectId, idempotencyKey));
    if (!runId) return null;
    return this.runs.get(runId)?.header ?? null;
  }

  async getRun(runId: string): Promise<BusinessLogicRunRecord | null> {
    return this.runs.get(runId)?.header ?? null;
  }

  getArtifacts(runId: string): BusinessLogicPersistArtifacts | null {
    return this.runs.get(runId)?.artifacts ?? null;
  }

  getRevision(runId: string): number {
    return this.runs.get(runId)?.revision ?? 0;
  }

  async persistRun(input: {
    header: Omit<BusinessLogicRunRecord, "createdAt" | "updatedAt">;
    artifacts: BusinessLogicPersistArtifacts;
    revisionReason?: string | null;
  }): Promise<PersistBusinessLogicRunOutcome> {
    const now = new Date().toISOString();
    const existing = this.runs.get(input.header.id);
    const revision = (existing?.revision ?? 0) + 1;

    const header: BusinessLogicRunRecord = {
      ...input.header,
      createdAt: existing?.header.createdAt ?? now,
      updatedAt: now,
    };

    this.runs.set(input.header.id, {
      header,
      artifacts: input.artifacts,
      revision,
    });

    if (input.header.idempotencyKey) {
      this.idempotency.set(
        this.idemKey(input.header.projectId, input.header.idempotencyKey),
        input.header.id
      );
    }

    return {
      runId: input.header.id,
      revision,
      persisted: true,
      partialPersistence: input.header.partialPersistence,
      counts: {
        workflows: input.artifacts.workflows.length,
        fsms: input.artifacts.stateMachines.length,
        invariants: input.artifacts.invariants.length,
        abuseCases: input.artifacts.abuseCases.length,
        specialists: input.artifacts.specialistResults.length,
        runtimeResults: input.artifacts.runtimeResults.length,
        findings: input.artifacts.findings.length,
        replayPlans: input.artifacts.replayPlans.length,
      },
    };
  }
}

export function createInMemoryBusinessLogicRunStore(): InMemoryBusinessLogicRunStore {
  return new InMemoryBusinessLogicRunStore();
}
